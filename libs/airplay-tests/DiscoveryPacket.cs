using System.Text;

namespace HomeyDash.AirPlay.Tests;

/// <summary>An mDNS answer as an Apple TV sends it: the PTR in the answers, the rest in the additional records, names compressed.</summary>
internal static class DiscoveryPacket
{
    public static byte[] AppleTvAnswer()
    {
        var packet = new List<byte> { 0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 3 };

        // Answer: _airplay._tcp.local PTR "Living Room._airplay._tcp.local"
        var serviceOffset = packet.Count;
        packet.AddRange(Name("_airplay._tcp.local"));
        var instance = Name("Living Room") .Take(1 + "Living Room".Length).ToList();
        Record(packet, 12, [.. instance, 0xC0, (byte)serviceOffset]);
        // The instance name starts inside that record's data; later records point at it.
        var instanceOffset = packet.Count - (instance.Count + 2);

        // Additional: SRV, TXT (owner = pointer to the instance name), A for the host
        packet.AddRange([0xC0, (byte)instanceOffset]);
        var srv = new List<byte> { 0, 0, 0, 0, 0x1B, 0x58 };
        var hostOffset = packet.Count + 10 + srv.Count;
        srv.AddRange(Name("Living-Room.local"));
        RecordBody(packet, 33, [.. srv]);

        packet.AddRange([0xC0, (byte)instanceOffset]);
        var txt = new List<byte>();
        foreach (var entry in new[] { "deviceid=B2:19:DD:A9:4C:0D", "features=0x4A7FDFD5,0x3C155FDE", "model=AppleTV14,1", "pw=false" })
        {
            txt.Add((byte)entry.Length);
            txt.AddRange(Encoding.UTF8.GetBytes(entry));
        }
        RecordBody(packet, 16, [.. txt]);

        packet.AddRange([0xC0, (byte)hostOffset]);
        RecordBody(packet, 1, [192, 168, 1, 23]);
        return [.. packet];
    }

    private static byte[] Name(string name)
    {
        var bytes = new List<byte>();
        foreach (var label in name.Split('.'))
        {
            bytes.Add((byte)label.Length);
            bytes.AddRange(Encoding.UTF8.GetBytes(label));
        }
        bytes.Add(0);
        return [.. bytes];
    }

    private static void Record(List<byte> packet, ushort type, byte[] data)
    {
        // type, class, ttl, length, data (the owner name was already written)
        RecordBody(packet, type, data);
    }

    private static void RecordBody(List<byte> packet, ushort type, byte[] data)
    {
        packet.AddRange([(byte)(type >> 8), (byte)type, 0, 1, 0, 0, 0x0E, 0x10, (byte)(data.Length >> 8), (byte)data.Length]);
        packet.AddRange(data);
    }
}
