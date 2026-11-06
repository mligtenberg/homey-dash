using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;

namespace HomeyDash.AirPlay;

/// <summary>
/// Finds receivers with a one-shot mDNS browse for _airplay._tcp. The query goes out from an ephemeral port, which makes
/// responders answer to that port directly, so nothing has to bind the mDNS port that the operating system may hold.
/// </summary>
public static class Discovery
{
    private const string Service = "_airplay._tcp.local";
    private static readonly IPEndPoint Multicast = new(IPAddress.Parse("224.0.0.251"), 5353);

    public static async Task<IReadOnlyList<Receiver>> ScanAsync(TimeSpan duration, CancellationToken ct)
    {
        var instances = new Dictionary<string, Instance>(StringComparer.OrdinalIgnoreCase);
        var addresses = new Dictionary<string, HashSet<IPAddress>>(StringComparer.OrdinalIgnoreCase);

        using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
        socket.Bind(new IPEndPoint(IPAddress.Any, 0));
        var interfaces = LocalAddresses();

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(duration);
        var buffer = new byte[9000];
        var nextQuery = DateTime.MinValue;
        var queries = 0;
        try
        {
            while (!timeout.IsCancellationRequested)
            {
                if (DateTime.UtcNow >= nextQuery && queries < 3)
                {
                    Send(socket, interfaces, BuildQuery([(Service, 12)]));
                    var missing = instances.Values.Where(i => i.Port == 0 || i.Txt.Count == 0).Select(i => (i.Name, (ushort)255))
                        .Concat(instances.Values.Where(i => i.Target is not null && !addresses.ContainsKey(i.Target)).Select(i => (i.Target!, (ushort)1))).ToList();
                    if (missing.Count > 0) Send(socket, interfaces, BuildQuery(missing));
                    queries++;
                    nextQuery = DateTime.UtcNow.AddMilliseconds(900);
                }

                using var wait = CancellationTokenSource.CreateLinkedTokenSource(timeout.Token);
                wait.CancelAfter(300);
                try
                {
                    var read = await socket.ReceiveFromAsync(buffer, SocketFlags.None, new IPEndPoint(IPAddress.Any, 0), wait.Token);
                    DnsMessage.Collect(buffer.AsSpan(0, read.ReceivedBytes), instances, addresses);
                }
                catch (OperationCanceledException) when (!timeout.IsCancellationRequested)
                {
                }
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
        }

        return Resolve(instances, addresses);
    }

    internal static void Collect(ReadOnlySpan<byte> message, Dictionary<string, Instance> instances, Dictionary<string, HashSet<IPAddress>> addresses) =>
        DnsMessage.Collect(message, instances, addresses);

    internal static IReadOnlyList<Receiver> Resolve(Dictionary<string, Instance> instances, Dictionary<string, HashSet<IPAddress>> addresses)
    {
        var found = new Dictionary<string, Receiver>(StringComparer.OrdinalIgnoreCase);
        foreach (var instance in instances.Values)
        {
            if (instance.Port == 0 || instance.Target is null || !addresses.TryGetValue(instance.Target, out var ips)) continue;
            if (!instance.Txt.TryGetValue("deviceid", out var id) || string.IsNullOrWhiteSpace(id)) continue;
            var address = ips.FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork);
            if (address is null) continue;
            instance.Txt.TryGetValue("model", out var model);
            instance.Txt.TryGetValue("features", out var features);
            // A receiver with several network interfaces answers once per interface; the first one wins.
            found.TryAdd(id, new Receiver(id.ToUpperInvariant(), instance.Label, address, instance.Port, Receiver.KindOf(model, features), model ?? ""));
        }
        return found.Values.OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static IEnumerable<IPAddress> LocalAddresses() =>
        NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up && n.SupportsMulticast && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
            .SelectMany(n => n.GetIPProperties().UnicastAddresses)
            .Select(a => a.Address)
            .Where(a => a.AddressFamily == AddressFamily.InterNetwork && !a.ToString().StartsWith("169.254", StringComparison.Ordinal))
            .ToList();

    private static void Send(Socket socket, IEnumerable<IPAddress> interfaces, byte[] query)
    {
        foreach (var address in interfaces)
        {
            try
            {
                socket.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastInterface, address.GetAddressBytes());
                socket.SendTo(query, Multicast);
            }
            catch (SocketException)
            {
                // An interface that can't multicast (a VPN, a bridge) is skipped.
            }
        }
    }

    internal static byte[] BuildQuery(IEnumerable<(string Name, ushort Type)> questions)
    {
        var list = questions.ToList();
        using var output = new MemoryStream();
        output.Write([0, 0, 0, 0, (byte)(list.Count >> 8), (byte)list.Count, 0, 0, 0, 0, 0, 0]);
        foreach (var (name, type) in list)
        {
            foreach (var label in name.Split('.', StringSplitOptions.RemoveEmptyEntries))
            {
                var bytes = Encoding.UTF8.GetBytes(label);
                output.WriteByte((byte)bytes.Length);
                output.Write(bytes);
            }
            output.WriteByte(0);
            output.Write([(byte)(type >> 8), (byte)type, 0, 1]);
        }
        return output.ToArray();
    }

    internal sealed class Instance(string name)
    {
        public string Name { get; } = name;
        public string Label => Name.Contains("._", StringComparison.Ordinal) ? Name[..Name.IndexOf("._", StringComparison.Ordinal)] : Name;
        public int Port { get; set; }
        public string? Target { get; set; }
        public Dictionary<string, string> Txt { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private static class DnsMessage
    {
        public static void Collect(ReadOnlySpan<byte> message, Dictionary<string, Instance> instances, Dictionary<string, HashSet<IPAddress>> addresses)
        {
            try
            {
                var data = message.ToArray();
                if (data.Length < 12) return;
                var questions = data[4] << 8 | data[5];
                var records = (data[6] << 8 | data[7]) + (data[8] << 8 | data[9]) + (data[10] << 8 | data[11]);
                var position = 12;
                for (var i = 0; i < questions; i++)
                {
                    ReadName(data, ref position);
                    position += 4;
                }
                for (var i = 0; i < records; i++)
                {
                    var name = ReadName(data, ref position);
                    var type = data[position] << 8 | data[position + 1];
                    var length = data[position + 8] << 8 | data[position + 9];
                    var start = position + 10;
                    position = start + length;
                    switch (type)
                    {
                        case 12 when name.Equals(Service, StringComparison.OrdinalIgnoreCase):
                            var pointer = start;
                            var instanceName = ReadName(data, ref pointer);
                            if (!instances.ContainsKey(instanceName)) instances[instanceName] = new Instance(instanceName);
                            break;
                        case 33 or 16 when !name.EndsWith("." + Service, StringComparison.OrdinalIgnoreCase):
                            break;
                        case 33:
                            var target = start + 6;
                            var host = ReadName(data, ref target);
                            var instance = Get(instances, name);
                            instance.Port = data[start + 4] << 8 | data[start + 5];
                            instance.Target = host;
                            break;
                        case 16:
                            var txt = Get(instances, name).Txt;
                            for (var offset = start; offset < start + length;)
                            {
                                var size = data[offset++];
                                var entry = Encoding.UTF8.GetString(data, offset, Math.Min(size, start + length - offset));
                                offset += size;
                                var equals = entry.IndexOf('=');
                                if (equals > 0) txt[entry[..equals]] = entry[(equals + 1)..];
                            }
                            break;
                        case 1 when length == 4:
                            if (!addresses.TryGetValue(name, out var set)) addresses[name] = set = [];
                            set.Add(new IPAddress(data.AsSpan(start, 4)));
                            break;
                    }
                }
            }
            catch (IndexOutOfRangeException)
            {
                // A truncated or odd packet from something else on the network.
            }
            catch (ArgumentException)
            {
            }
        }

        private static Instance Get(Dictionary<string, Instance> instances, string name)
        {
            if (!instances.TryGetValue(name, out var instance)) instances[name] = instance = new Instance(name);
            return instance;
        }

        private static string ReadName(byte[] data, ref int position)
        {
            var labels = new List<string>();
            var next = -1;
            var current = position;
            for (var hops = 0; hops < 32; hops++)
            {
                var length = data[current];
                if (length == 0)
                {
                    current++;
                    break;
                }
                if ((length & 0xC0) == 0xC0)
                {
                    if (next < 0) next = current + 2;
                    current = (length & 0x3F) << 8 | data[current + 1];
                    continue;
                }
                labels.Add(Encoding.UTF8.GetString(data, current + 1, length));
                current += 1 + length;
            }
            position = next >= 0 ? next : current;
            return string.Join('.', labels);
        }
    }
}
