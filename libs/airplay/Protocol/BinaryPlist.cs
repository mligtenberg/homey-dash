using System.Buffers.Binary;
using System.Text;

namespace HomeyDash.AirPlay.Protocol;

/// <summary>
/// Apple's binary property list, which AirPlay speaks. Dictionaries are Dictionary&lt;string, object?&gt;, arrays are
/// List&lt;object?&gt;; other values are string, long, double, bool and byte[].
/// </summary>
internal static class BinaryPlist
{
    private static readonly byte[] Magic = "bplist00"u8.ToArray();

    // ---- Reading ----

    public static object? Read(byte[] data)
    {
        if (data.Length < 40 || !data.AsSpan(0, 8).SequenceEqual(Magic)) throw new AirPlayException("The receiver sent something that isn't a property list.");
        var trailer = data.AsSpan(data.Length - 32);
        var offsetSize = trailer[6];
        var refSize = trailer[7];
        var count = (int)BinaryPrimitives.ReadUInt64BigEndian(trailer[8..]);
        var top = (int)BinaryPrimitives.ReadUInt64BigEndian(trailer[16..]);
        var tableOffset = (int)BinaryPrimitives.ReadUInt64BigEndian(trailer[24..]);

        int OffsetOf(int index) => (int)ReadUnsigned(data.AsSpan(tableOffset + index * offsetSize, offsetSize));

        object? Parse(int index, int depth)
        {
            if (depth > 64 || index < 0 || index >= count) throw new AirPlayException("The property list is malformed.");
            var position = OffsetOf(index);
            var marker = data[position];
            var kind = marker >> 4;
            var info = marker & 0xF;

            (int Length, int Start) LengthAndStart()
            {
                if (info != 0xF) return (info, position + 1);
                var intSize = 1 << (data[position + 1] & 0xF);
                return ((int)ReadUnsigned(data.AsSpan(position + 2, intSize)), position + 2 + intSize);
            }

            switch (kind)
            {
                case 0x0:
                    return marker switch { 0x08 => false, 0x09 => true, _ => null };
                case 0x1:
                    var size = 1 << info;
                    var raw = data.AsSpan(position + 1, size);
                    return size == 8 ? BinaryPrimitives.ReadInt64BigEndian(raw) : (long)ReadUnsigned(raw);
                case 0x2:
                    return info == 2 ? BinaryPrimitives.ReadSingleBigEndian(data.AsSpan(position + 1)) : BinaryPrimitives.ReadDoubleBigEndian(data.AsSpan(position + 1));
                case 0x3:
                    return BinaryPrimitives.ReadDoubleBigEndian(data.AsSpan(position + 1));
                case 0x4:
                    var (dataLength, dataStart) = LengthAndStart();
                    return data.AsSpan(dataStart, dataLength).ToArray();
                case 0x5:
                    var (asciiLength, asciiStart) = LengthAndStart();
                    return Encoding.ASCII.GetString(data.AsSpan(asciiStart, asciiLength));
                case 0x6:
                    var (charCount, charStart) = LengthAndStart();
                    return Encoding.BigEndianUnicode.GetString(data.AsSpan(charStart, charCount * 2));
                case 0x8:
                    return (long)ReadUnsigned(data.AsSpan(position + 1, info + 1));
                case 0xA:
                    var (items, itemsStart) = LengthAndStart();
                    var list = new List<object?>(items);
                    for (var i = 0; i < items; i++) list.Add(Parse((int)ReadUnsigned(data.AsSpan(itemsStart + i * refSize, refSize)), depth + 1));
                    return list;
                case 0xD:
                    var (entries, entriesStart) = LengthAndStart();
                    var dictionary = new Dictionary<string, object?>(entries);
                    for (var i = 0; i < entries; i++)
                    {
                        var key = Parse((int)ReadUnsigned(data.AsSpan(entriesStart + i * refSize, refSize)), depth + 1) as string
                            ?? throw new AirPlayException("The property list has a key that is not text.");
                        dictionary[key] = Parse((int)ReadUnsigned(data.AsSpan(entriesStart + (entries + i) * refSize, refSize)), depth + 1);
                    }
                    return dictionary;
                default:
                    throw new AirPlayException("The property list holds a kind of value that isn't supported.");
            }
        }

        return Parse(top, 0);
    }

    public static Dictionary<string, object?> ReadDictionary(byte[] data) =>
        Read(data) as Dictionary<string, object?> ?? throw new AirPlayException("The receiver's reply is not a dictionary.");

    private static ulong ReadUnsigned(ReadOnlySpan<byte> bytes)
    {
        ulong value = 0;
        foreach (var b in bytes) value = value << 8 | b;
        return value;
    }

    // ---- Writing ----

    public static byte[] Write(object? root)
    {
        var objects = new List<object?>();
        var topIndex = Flatten(root, objects);
        var refSize = objects.Count < 256 ? 1 : objects.Count < 65536 ? 2 : 4;

        using var body = new MemoryStream();
        body.Write(Magic);
        var offsets = new List<long>(objects.Count);
        foreach (var item in objects)
        {
            offsets.Add(body.Position);
            WriteObject(body, item, refSize, objects);
        }

        var tableOffset = body.Position;
        var offsetSize = tableOffset < 256 ? 1 : tableOffset < 65536 ? 2 : tableOffset < uint.MaxValue ? 4 : 8;
        foreach (var offset in offsets) WriteUnsigned(body, (ulong)offset, offsetSize);

        Span<byte> trailer = stackalloc byte[32];
        trailer.Clear();
        trailer[6] = (byte)offsetSize;
        trailer[7] = (byte)refSize;
        BinaryPrimitives.WriteUInt64BigEndian(trailer[8..], (ulong)objects.Count);
        BinaryPrimitives.WriteUInt64BigEndian(trailer[16..], (ulong)topIndex);
        BinaryPrimitives.WriteUInt64BigEndian(trailer[24..], (ulong)tableOffset);
        body.Write(trailer);
        return body.ToArray();
    }

    // A container is stored as references into this list, so its children are flattened in first.
    private sealed record Container(List<int> Keys, List<int> Values, bool IsDictionary);

    private static int Flatten(object? value, List<object?> objects)
    {
        switch (value)
        {
            case IReadOnlyDictionary<string, object?> dictionary:
                var slot = objects.Count;
                objects.Add(null);
                var keys = dictionary.Keys.Select(k => Flatten(k, objects)).ToList();
                var values = dictionary.Values.Select(v => Flatten(v, objects)).ToList();
                objects[slot] = new Container(keys, values, true);
                return slot;
            case IEnumerable<object?> list when value is not string and not byte[]:
                var listSlot = objects.Count;
                objects.Add(null);
                var items = list.Select(v => Flatten(v, objects)).ToList();
                objects[listSlot] = new Container([], items, false);
                return listSlot;
            default:
                objects.Add(value);
                return objects.Count - 1;
        }
    }

    private static void WriteObject(Stream output, object? value, int refSize, List<object?> objects)
    {
        switch (value)
        {
            case null:
                output.WriteByte(0x00);
                break;
            case bool flag:
                output.WriteByte(flag ? (byte)0x09 : (byte)0x08);
                break;
            case int or long or short or byte:
                var number = Convert.ToInt64(value);
                if (number < 0) { output.WriteByte(0x13); WriteUnsigned(output, (ulong)number, 8); }
                else if (number < 256) { output.WriteByte(0x10); WriteUnsigned(output, (ulong)number, 1); }
                else if (number < 65536) { output.WriteByte(0x11); WriteUnsigned(output, (ulong)number, 2); }
                else if (number <= uint.MaxValue) { output.WriteByte(0x12); WriteUnsigned(output, (ulong)number, 4); }
                else { output.WriteByte(0x13); WriteUnsigned(output, (ulong)number, 8); }
                break;
            case double or float:
                output.WriteByte(0x23);
                Span<byte> real = stackalloc byte[8];
                BinaryPrimitives.WriteDoubleBigEndian(real, Convert.ToDouble(value));
                output.Write(real);
                break;
            case byte[] bytes:
                WriteMarker(output, 0x40, bytes.Length);
                output.Write(bytes);
                break;
            case string text when text.All(c => c < 128):
                WriteMarker(output, 0x50, text.Length);
                output.Write(Encoding.ASCII.GetBytes(text));
                break;
            case string text:
                WriteMarker(output, 0x60, text.Length);
                output.Write(Encoding.BigEndianUnicode.GetBytes(text));
                break;
            case Container container:
                WriteMarker(output, container.IsDictionary ? 0xD0 : 0xA0, container.Values.Count);
                foreach (var key in container.Keys) WriteUnsigned(output, (ulong)key, refSize);
                foreach (var item in container.Values) WriteUnsigned(output, (ulong)item, refSize);
                break;
            default:
                throw new AirPlayException($"A {value.GetType().Name} can't go in a property list.");
        }
    }

    private static void WriteMarker(Stream output, int kind, int length)
    {
        if (length < 15)
        {
            output.WriteByte((byte)(kind | length));
            return;
        }
        output.WriteByte((byte)(kind | 0xF));
        if (length < 256) { output.WriteByte(0x10); WriteUnsigned(output, (ulong)length, 1); }
        else if (length < 65536) { output.WriteByte(0x11); WriteUnsigned(output, (ulong)length, 2); }
        else { output.WriteByte(0x12); WriteUnsigned(output, (ulong)length, 4); }
    }

    private static void WriteUnsigned(Stream output, ulong value, int size)
    {
        for (var shift = (size - 1) * 8; shift >= 0; shift -= 8) output.WriteByte((byte)(value >> shift));
    }
}
