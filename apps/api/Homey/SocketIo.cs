using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace HomeyDash.Api.Homey;

// A Socket.IO packet as Homey's realtime API speaks it: Socket.IO v2 over Engine.IO v3.
// Binary packets are not used by Homey and not supported.
public readonly record struct SocketIoPacket(SocketIoPacketType Type, string Namespace, int? AckId, JsonElement? Data)
{
    public static string Encode(SocketIoPacketType type, string ns, int? ackId = null, object? data = null)
    {
        var builder = new StringBuilder().Append((int)type);
        if (ns != "/") builder.Append(ns).Append(',');
        if (ackId is not null) builder.Append(ackId);
        if (data is not null) builder.Append(JsonSerializer.Serialize(data));
        return builder.ToString();
    }

    public static SocketIoPacket Decode(string text)
    {
        var type = (SocketIoPacketType)(text[0] - '0');
        var i = 1;
        var ns = "/";
        if (i < text.Length && text[i] == '/')
        {
            var end = text.IndexOf(',', i);
            ns = end < 0 ? text[i..] : text[i..end];
            i = end < 0 ? text.Length : end + 1;
        }

        var idStart = i;
        while (i < text.Length && char.IsAsciiDigit(text[i])) i++;
        int? ackId = i > idStart ? int.Parse(text.AsSpan(idStart, i - idStart)) : null;

        JsonElement? data = i < text.Length ? JsonDocument.Parse(text.AsMemory(i)).RootElement.Clone() : null;
        return new SocketIoPacket(type, ns, ackId, data);
    }
}

public enum SocketIoPacketType { Connect = 0, Disconnect = 1, Event = 2, Ack = 3, Error = 4 }

/// <summary>
/// A minimal Socket.IO v2 client: one WebSocket, several namespaces, events and acks.
/// <see cref="Completion"/> ends, faulted, as soon as the connection is lost; the owner reconnects.
/// </summary>
public sealed class SocketIoClient : IAsyncDisposable
{
    private readonly ClientWebSocket _socket = new();
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly CancellationTokenSource _stop = new();
    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonElement>> _acks = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource> _namespaces = new();
    private readonly TaskCompletionSource<(TimeSpan Interval, TimeSpan Timeout)> _opened =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int _nextAckId;
    private long _lastReceived = Environment.TickCount64;

    // An event arrived: its namespace, name and arguments.
    public event Action<string, string, JsonElement[]>? EventReceived;

    public Task Completion { get; private set; } = Task.CompletedTask;

    public static TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(10);

    public static async Task<SocketIoClient> ConnectAsync(Uri address, CancellationToken ct)
    {
        var client = new SocketIoClient();
        var scheme = address.Scheme == Uri.UriSchemeHttps ? "wss" : "ws";
        var url = new UriBuilder(address) { Scheme = scheme, Path = "/socket.io/", Query = "EIO=3&transport=websocket" }.Uri;
        try
        {
            await client._socket.ConnectAsync(url, ct);
            var receive = client.ReceiveLoopAsync();
            var (interval, timeout) = await client._opened.Task.WaitAsync(RequestTimeout, ct);
            client.Completion = Task.WhenAny(receive, client.PingLoopAsync(interval, timeout)).Unwrap();
            return client;
        }
        catch
        {
            await client.DisposeAsync();
            throw;
        }
    }

    public async Task ConnectNamespaceAsync(string ns, CancellationToken ct)
    {
        var connected = _namespaces.GetOrAdd(ns, _ => new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
        await SendAsync("4" + SocketIoPacket.Encode(SocketIoPacketType.Connect, ns), ct);
        await connected.Task.WaitAsync(RequestTimeout, ct);
    }

    // Emits an event and returns the arguments the server acknowledged it with.
    public async Task<JsonElement> EmitWithAckAsync(string ns, string name, object?[] args, CancellationToken ct)
    {
        var id = Interlocked.Increment(ref _nextAckId);
        var ack = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _acks[id] = ack;
        try
        {
            await SendAsync("4" + SocketIoPacket.Encode(SocketIoPacketType.Event, ns, id, new object?[] { name }.Concat(args)), ct);
            return await ack.Task.WaitAsync(RequestTimeout, ct);
        }
        finally
        {
            _acks.TryRemove(id, out _);
        }
    }

    private async Task ReceiveLoopAsync()
    {
        var buffer = new byte[16 * 1024];
        using var message = new MemoryStream();
        while (true)
        {
            var result = await _socket.ReceiveAsync(buffer, _stop.Token);
            if (result.MessageType == WebSocketMessageType.Close)
                throw new WebSocketException("Homey closed the realtime connection");

            message.Write(buffer, 0, result.Count);
            if (!result.EndOfMessage) continue;

            var text = Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length);
            message.SetLength(0);
            Interlocked.Exchange(ref _lastReceived, Environment.TickCount64);
            HandleEnginePacket(text);
        }
    }

    private void HandleEnginePacket(string text)
    {
        switch (text[0])
        {
            case '0':
                var open = JsonDocument.Parse(text.AsMemory(1)).RootElement;
                _opened.TrySetResult((
                    TimeSpan.FromMilliseconds(open.GetProperty("pingInterval").GetInt32()),
                    TimeSpan.FromMilliseconds(open.GetProperty("pingTimeout").GetInt32())));
                break;
            case '1':
                throw new WebSocketException("Homey closed the realtime connection");
            case '4':
                HandleSocketPacket(SocketIoPacket.Decode(text[1..]));
                break;
        }
    }

    private void HandleSocketPacket(SocketIoPacket packet)
    {
        switch (packet.Type)
        {
            case SocketIoPacketType.Connect:
                _namespaces.GetOrAdd(packet.Namespace, _ => new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously))
                    .TrySetResult();
                break;
            case SocketIoPacketType.Error:
                if (_namespaces.TryGetValue(packet.Namespace, out var pending))
                    pending.TrySetException(new InvalidOperationException($"Homey refused namespace {packet.Namespace}: {packet.Data}"));
                break;
            case SocketIoPacketType.Disconnect:
                throw new WebSocketException($"Homey disconnected namespace {packet.Namespace}");
            case SocketIoPacketType.Ack when packet.AckId is { } id && _acks.TryGetValue(id, out var ack):
                ack.TrySetResult(packet.Data ?? default);
                break;
            case SocketIoPacketType.Event when packet.Data is { ValueKind: JsonValueKind.Array } data:
                var items = data.EnumerateArray().ToArray();
                if (items is [{ ValueKind: JsonValueKind.String } name, .. var args])
                    EventReceived?.Invoke(packet.Namespace, name.GetString()!, args);
                break;
        }
    }

    // Engine.IO v3: the client pings, and a connection that stays silent too long is dead.
    private async Task PingLoopAsync(TimeSpan interval, TimeSpan timeout)
    {
        while (true)
        {
            await Task.Delay(interval, _stop.Token);
            if (Environment.TickCount64 - Interlocked.Read(ref _lastReceived) > (interval + timeout).TotalMilliseconds)
                throw new TimeoutException("Homey stopped answering on the realtime connection");
            await SendAsync("2", _stop.Token);
        }
    }

    private async Task SendAsync(string text, CancellationToken ct)
    {
        await _sendLock.WaitAsync(ct);
        try
        {
            await _socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, ct);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _stop.CancelAsync();
        if (_socket.State == WebSocketState.Open)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
            try { await _socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, timeout.Token); }
            catch (Exception e) when (e is WebSocketException or OperationCanceledException) { }
        }
        _socket.Dispose();
        _stop.Dispose();
    }
}
