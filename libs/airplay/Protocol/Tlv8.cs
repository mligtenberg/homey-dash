namespace HomeyDash.AirPlay.Protocol;

/// <summary>The HomeKit pairing message tags.</summary>
internal static class Tag
{
    public const byte Method = 0x00, Identifier = 0x01, Salt = 0x02, PublicKey = 0x03, Proof = 0x04, EncryptedData = 0x05,
        SeqNo = 0x06, Error = 0x07, BackOff = 0x08, Signature = 0x0A, Name = 0x11;
}

/// <summary>TLV8, the message format of HomeKit pairing: tag, length, value; a value over 255 bytes continues in a repeated tag.</summary>
internal static class Tlv8
{
    public static byte[] Write(params (byte Tag, byte[] Value)[] items)
    {
        using var output = new MemoryStream();
        foreach (var (tag, value) in items)
        {
            if (value.Length == 0)
            {
                output.WriteByte(tag);
                output.WriteByte(0);
                continue;
            }
            for (var position = 0; position < value.Length; position += 255)
            {
                var size = Math.Min(255, value.Length - position);
                output.WriteByte(tag);
                output.WriteByte((byte)size);
                output.Write(value, position, size);
            }
        }
        return output.ToArray();
    }

    public static Dictionary<byte, byte[]> Read(ReadOnlySpan<byte> data)
    {
        var result = new Dictionary<byte, byte[]>();
        var position = 0;
        while (position + 2 <= data.Length)
        {
            var tag = data[position];
            var length = data[position + 1];
            var end = Math.Min(position + 2 + length, data.Length);
            var value = data[(position + 2)..end].ToArray();
            result[tag] = result.TryGetValue(tag, out var earlier) ? [.. earlier, .. value] : value;
            position = end;
        }
        return result;
    }
}
