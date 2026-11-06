using System.Net;
using System.Text;
using HomeyDash.AirPlay.Crypto;

namespace HomeyDash.AirPlay.Protocol;

/// <summary>
/// The second connection the receiver opens a port for. It sends what happens on its side (playback state) as RTSP-like
/// requests with a property list, and wants each answered with an empty 200.
/// </summary>
internal sealed class EventChannel : IDisposable
{
    private readonly System.Net.Sockets.TcpClient _client;
    private readonly Stream _stream;
    private readonly HapStream _hap;
    private readonly Action<Dictionary<string, object?>> _onEvent;
    private readonly Action _onClosed;
    private readonly CancellationTokenSource _stop = new();
    private byte[] _buffer = [];

    private EventChannel(System.Net.Sockets.TcpClient client, HapStream hap, Action<Dictionary<string, object?>> onEvent, Action onClosed)
    {
        _client = client;
        _stream = client.GetStream();
        _hap = hap;
        _onEvent = onEvent;
        _onClosed = onClosed;
        _ = Task.Run(ReadAsync);
    }

    // The receiver may set the port up a moment after telling us about it, so a refused connection is tried again.
    public static async Task<EventChannel> ConnectAsync(IPAddress address, int port, byte[] sharedSecret, Action<Dictionary<string, object?>> onEvent, Action onClosed, CancellationToken ct)
    {
        var writeKey = HapCrypto.Hkdf("Events-Salt", "Events-Read-Encryption-Key", sharedSecret);
        var readKey = HapCrypto.Hkdf("Events-Salt", "Events-Write-Encryption-Key", sharedSecret);
        for (var attempt = 1; ; attempt++)
        {
            var client = new System.Net.Sockets.TcpClient(address.AddressFamily) { NoDelay = true };
            try
            {
                await client.ConnectAsync(address, port, ct);
                return new EventChannel(client, new HapStream(writeKey, readKey), onEvent, onClosed);
            }
            catch (System.Net.Sockets.SocketException) when (attempt < 5)
            {
                client.Dispose();
                await Task.Delay(1000, ct);
            }
            catch (System.Net.Sockets.SocketException e)
            {
                client.Dispose();
                throw new AirPlayException("The receiver didn't open its event connection.", e);
            }
        }
    }

    private async Task ReadAsync()
    {
        var chunk = new byte[16 * 1024];
        try
        {
            while (!_stop.IsCancellationRequested)
            {
                var read = await _stream.ReadAsync(chunk, _stop.Token);
                if (read == 0) break;
                _buffer = [.. _buffer, .. _hap.Decrypt(chunk.AsSpan(0, read))];
                while (TryTakeRequest(out var headers, out var body, out var first))
                {
                    HandleEvent(body);
                    await Reply(first, headers);
                }
            }
        }
        catch (Exception e) when (e is OperationCanceledException or IOException or ObjectDisposedException or AirPlayException)
        {
        }
        _onClosed();
    }

    private bool TryTakeRequest(out Dictionary<string, string> headers, out byte[] body, out string firstLine)
    {
        headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        body = [];
        firstLine = "";
        var end = Connection.IndexOf(_buffer, "\r\n\r\n"u8);
        if (end < 0) return false;
        var lines = Encoding.UTF8.GetString(_buffer, 0, end).Split("\r\n");
        foreach (var line in lines.Skip(1))
        {
            var colon = line.IndexOf(':');
            if (colon > 0) headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
        }
        var length = headers.TryGetValue("Content-Length", out var value) && int.TryParse(value, out var parsed) ? parsed : 0;
        if (_buffer.Length < end + 4 + length) return false;
        body = _buffer[(end + 4)..(end + 4 + length)];
        _buffer = _buffer[(end + 4 + length)..];
        firstLine = lines[0];
        return true;
    }

    private void HandleEvent(byte[] body)
    {
        if (body.Length == 0) return;
        try
        {
            var payload = BinaryPlist.ReadDictionary(body);
            // Some events carry their real content as a property list inside params.data.
            if (payload.TryGetValue("params", out var parameters) && parameters is Dictionary<string, object?> inner && inner.TryGetValue("data", out var nested) && nested is byte[] nestedBytes)
                payload = BinaryPlist.ReadDictionary(nestedBytes);
            _onEvent(payload);
        }
        catch (AirPlayException)
        {
            // Something that isn't a property list isn't an event we know.
        }
    }

    private async Task Reply(string requestLine, Dictionary<string, string> request)
    {
        var protocol = requestLine.Split(' ').LastOrDefault() is { Length: > 0 } last && last.Contains('/') ? last : "RTSP/1.0";
        var text = new StringBuilder($"{protocol} 200 OK\r\nContent-Length: 0\r\nAudio-Latency: 0");
        text.Append("\r\nServer: ").Append(request.GetValueOrDefault("Server", "AirTunes/366.0"));
        if (request.TryGetValue("CSeq", out var cseq)) text.Append("\r\nCSeq: ").Append(cseq);
        text.Append("\r\n\r\n");
        await _stream.WriteAsync(_hap.Encrypt(Encoding.UTF8.GetBytes(text.ToString())), _stop.Token);
    }

    public void Dispose()
    {
        _stop.Cancel();
        _client.Dispose();
    }
}
