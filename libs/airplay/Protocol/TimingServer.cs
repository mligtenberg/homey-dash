using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;

namespace HomeyDash.AirPlay.Protocol;

/// <summary>
/// The NTP-like timing service a receiver asks our clock from (SETUP gives it our port). It sends 32 byte requests and
/// expects the same layout back with the time we received it and the time we answered.
/// </summary>
internal sealed class TimingServer : IDisposable
{
    private readonly UdpClient _udp;
    private readonly CancellationTokenSource _stop = new();

    public TimingServer(IPAddress local)
    {
        _udp = new UdpClient(new IPEndPoint(local, 0));
        Port = ((IPEndPoint)_udp.Client.LocalEndPoint!).Port;
        _ = Task.Run(RunAsync);
    }

    public int Port { get; }

    private async Task RunAsync()
    {
        try
        {
            while (!_stop.IsCancellationRequested)
            {
                var received = await _udp.ReceiveAsync(_stop.Token);
                if (received.Buffer.Length < 32) continue;
                await _udp.SendAsync(Answer(received.Buffer, Now()), received.RemoteEndPoint, _stop.Token);
            }
        }
        catch (Exception e) when (e is OperationCanceledException or ObjectDisposedException or SocketException)
        {
        }
    }

    internal static byte[] Answer(byte[] request, ulong now)
    {
        var response = new byte[32];
        response[0] = request[0];
        response[1] = 0x53 | 0x80;
        BinaryPrimitives.WriteUInt16BigEndian(response.AsSpan(2), 7);
        // The request's send time comes back as the reference time; both our receive and send time are now.
        request.AsSpan(24, 8).CopyTo(response.AsSpan(8));
        BinaryPrimitives.WriteUInt64BigEndian(response.AsSpan(16), now);
        BinaryPrimitives.WriteUInt64BigEndian(response.AsSpan(24), now);
        return response;
    }

    /// <summary>The time as NTP counts it: seconds since 1900 in the high 32 bits, a binary fraction of a second in the low.</summary>
    internal static ulong Now()
    {
        var micros = (DateTime.UtcNow.Ticks - DateTime.UnixEpoch.Ticks) / 10;
        var seconds = (ulong)(micros / 1_000_000);
        var fraction = (ulong)(micros % 1_000_000);
        return (seconds + 0x83AA7E80) << 32 | (fraction << 32) / 1_000_000;
    }

    public void Dispose()
    {
        _stop.Cancel();
        _udp.Dispose();
    }
}
