using System.Net;
using System.Net.Sockets;
using System.Text;
using HomeyDash.AirPlay.Crypto;

namespace HomeyDash.AirPlay.Protocol;

internal sealed record Response(int Code, string Message, IReadOnlyDictionary<string, string> Headers, byte[] Body);

/// <summary>
/// One TCP connection to a receiver, speaking the HTTP/RTSP hybrid AirPlay uses. After pair-verify it switches to HAP
/// framing in both directions. Requests are one at a time: a response always belongs to the request just sent.
/// </summary>
internal sealed class Connection : IDisposable
{
    private static readonly TimeSpan ResponseTimeout = TimeSpan.FromSeconds(10);

    private readonly TcpClient _client;
    private readonly NetworkStream _stream;
    private readonly SemaphoreSlim _exchange = new(1, 1);
    private HapStream? _hap;
    private byte[] _buffer = [];

    private Connection(TcpClient client)
    {
        _client = client;
        _stream = client.GetStream();
        LocalAddress = ((IPEndPoint)client.Client.LocalEndPoint!).Address;
        RemoteAddress = ((IPEndPoint)client.Client.RemoteEndPoint!).Address;
    }

    public IPAddress LocalAddress { get; }
    public IPAddress RemoteAddress { get; }

    public static async Task<Connection> ConnectAsync(IPAddress address, int port, CancellationToken ct)
    {
        var client = new TcpClient(address.AddressFamily) { NoDelay = true };
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            await client.ConnectAsync(address, port, timeout.Token);
        }
        catch (Exception e) when (e is SocketException or OperationCanceledException && !ct.IsCancellationRequested)
        {
            client.Dispose();
            throw new AirPlayException($"Could not connect to the receiver at {address}:{port}.", e);
        }
        return new Connection(client);
    }

    public void EnableEncryption(byte[] writeKey, byte[] readKey)
    {
        _hap = new HapStream(writeKey, readKey);
        // Data that arrived with the last unencrypted reply can't be part of the encrypted stream.
        _buffer = [];
    }

    public Task<Response> PostAsync(string uri, byte[] body, CancellationToken ct) =>
        SendAsync("POST", uri, "HTTP/1.1", new Dictionary<string, string>
        {
            ["User-Agent"] = "AirPlay/320.20",
            ["Connection"] = "keep-alive",
            ["X-Apple-HKP"] = "3",
            ["Content-Type"] = "application/octet-stream",
        }, body, ct);

    /// <summary>Sends a request and waits for its response; anything but 2xx is an error unless allowError (a 403 always is).</summary>
    public async Task<Response> SendAsync(string method, string uri, string protocol, IReadOnlyDictionary<string, string> headers, byte[]? body, CancellationToken ct, bool allowError = false)
    {
        var text = new StringBuilder($"{method} {uri} {protocol}");
        var all = new Dictionary<string, string>(headers, StringComparer.OrdinalIgnoreCase);
        if (!all.ContainsKey("User-Agent")) text.Append("\r\nUser-Agent: AirPlay/550.10");
        if (body is { Length: > 0 }) text.Append("\r\nContent-Length: ").Append(body.Length);
        foreach (var (key, value) in headers) text.Append("\r\n").Append(key).Append(": ").Append(value);
        text.Append("\r\n\r\n");
        var message = Encoding.UTF8.GetBytes(text.ToString()).Concat(body ?? []).ToArray();

        await _exchange.WaitAsync(ct);
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(ResponseTimeout);
            Response response;
            try
            {
                var outgoing = _hap is null ? message : _hap.Encrypt(message);
                await _stream.WriteAsync(outgoing, timeout.Token);
                response = await ReadResponseAsync(timeout.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                throw new AirPlayException($"The receiver did not answer {method} {uri}.");
            }
            catch (IOException e)
            {
                throw new AirPlayException("The connection to the receiver was lost.", e);
            }

            if (response.Code == 403) throw new AirPlayException($"The receiver refused {method} {uri} (403, not authenticated).");
            if (response.Code is >= 200 and < 300 || allowError) return response;
            throw new AirPlayException($"The receiver answered {method} {uri} with {response.Code} {response.Message}.");
        }
        finally
        {
            _exchange.Release();
        }
    }

    private async Task<Response> ReadResponseAsync(CancellationToken ct)
    {
        var chunk = new byte[16 * 1024];
        while (true)
        {
            if (TryParse(out var response)) return response;
            var read = await _stream.ReadAsync(chunk, ct);
            if (read == 0) throw new AirPlayException("The receiver closed the connection.");
            var data = _hap is null ? chunk.AsSpan(0, read).ToArray() : _hap.Decrypt(chunk.AsSpan(0, read));
            _buffer = [.. _buffer, .. data];
        }
    }

    private bool TryParse(out Response response)
    {
        response = null!;
        var end = IndexOf(_buffer, "\r\n\r\n"u8);
        if (end < 0) return false;
        var lines = Encoding.UTF8.GetString(_buffer, 0, end).Split("\r\n");
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            var colon = line.IndexOf(':');
            if (colon > 0) headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
        }
        var length = headers.TryGetValue("Content-Length", out var value) && int.TryParse(value, out var parsed) ? parsed : 0;
        if (_buffer.Length < end + 4 + length) return false;

        var body = _buffer[(end + 4)..(end + 4 + length)];
        _buffer = _buffer[(end + 4 + length)..];

        // "RTSP/1.0 200 OK"; a line that isn't a response (the receiver asking us something) is dropped.
        var status = lines[0].Split(' ', 3);
        if (status.Length < 2 || !(status[0].StartsWith("RTSP/", StringComparison.Ordinal) || status[0].StartsWith("HTTP/", StringComparison.Ordinal)) || !int.TryParse(status[1], out var code))
            return TryParse(out response);
        response = new Response(code, status.Length > 2 ? status[2] : "", headers, body);
        return true;
    }

    internal static int IndexOf(byte[] data, ReadOnlySpan<byte> pattern) => data.AsSpan().IndexOf(pattern);

    public void Dispose()
    {
        _client.Dispose();
        _exchange.Dispose();
    }
}
