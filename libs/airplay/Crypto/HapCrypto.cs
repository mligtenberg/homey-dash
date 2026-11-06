using System.Security.Cryptography;
using System.Text;

namespace HomeyDash.AirPlay.Crypto;

internal static class HapCrypto
{
    /// <summary>HKDF-SHA512 to a 32 byte key, how HomeKit derives every key from a shared secret.</summary>
    public static byte[] Hkdf(string salt, string info, byte[] secret) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA512, secret, 32, Encoding.UTF8.GetBytes(salt), Encoding.UTF8.GetBytes(info));

    /// <summary>One message of the pairing handshake: the nonce is four zero bytes then the 8 character name (PV-Msg02, PS-Msg05...).</summary>
    public static byte[] Seal(byte[] key, string messageName, byte[] plain)
    {
        var sealedData = new byte[plain.Length + 16];
        using var cipher = new ChaCha20Poly1305(key);
        cipher.Encrypt(MessageNonce(messageName), plain, sealedData.AsSpan(0, plain.Length), sealedData.AsSpan(plain.Length));
        return sealedData;
    }

    public static byte[] Open(byte[] key, string messageName, byte[] sealedData)
    {
        if (sealedData.Length < 16) throw new AirPlayException("The receiver sent an incomplete message.");
        var plain = new byte[sealedData.Length - 16];
        using var cipher = new ChaCha20Poly1305(key);
        try
        {
            cipher.Decrypt(MessageNonce(messageName), sealedData.AsSpan(0, plain.Length), sealedData.AsSpan(plain.Length), plain);
        }
        catch (CryptographicException)
        {
            throw new AirPlayException("The receiver's reply could not be decrypted, so the keys don't match.");
        }
        return plain;
    }

    private static byte[] MessageNonce(string name)
    {
        var nonce = new byte[12];
        Encoding.ASCII.GetBytes(name).CopyTo(nonce, 4);
        return nonce;
    }
}

/// <summary>
/// HAP's framing of a TCP stream: data goes in frames of at most 1024 bytes, each a 2 byte little-endian length (also the
/// associated data), the encrypted bytes and a 16 byte tag. The nonce is four zero bytes then a counter per direction.
/// </summary>
internal sealed class HapStream(byte[] writeKey, byte[] readKey)
{
    public const int FrameSize = 1024;
    private const int TagSize = 16;

    private readonly ChaCha20Poly1305 _write = new(writeKey), _read = new(readKey);
    private ulong _writeCounter, _readCounter;
    private readonly List<byte> _pending = [];

    public byte[] Encrypt(ReadOnlySpan<byte> data)
    {
        var output = new List<byte>(data.Length + data.Length / FrameSize * 18 + 18);
        for (var position = 0; position < data.Length; position += FrameSize)
        {
            var chunk = data.Slice(position, Math.Min(FrameSize, data.Length - position));
            var length = new byte[2];
            length[0] = (byte)chunk.Length;
            length[1] = (byte)(chunk.Length >> 8);
            var frame = new byte[chunk.Length + TagSize];
            _write.Encrypt(Nonce(_writeCounter++), chunk, frame.AsSpan(0, chunk.Length), frame.AsSpan(chunk.Length), length);
            output.AddRange(length);
            output.AddRange(frame);
        }
        return [.. output];
    }

    /// <summary>Takes what arrived and returns what it decrypts to so far; a frame that isn't complete waits for the next call.</summary>
    public byte[] Decrypt(ReadOnlySpan<byte> data)
    {
        _pending.AddRange(data.ToArray());
        var output = new List<byte>();
        while (_pending.Count >= 2)
        {
            var size = _pending[0] | _pending[1] << 8;
            if (_pending.Count < 2 + size + TagSize) break;
            var frame = _pending.GetRange(2, size + TagSize).ToArray();
            var plain = new byte[size];
            try
            {
                _read.Decrypt(Nonce(_readCounter++), frame.AsSpan(0, size), frame.AsSpan(size), plain, new[] { _pending[0], _pending[1] });
            }
            catch (CryptographicException)
            {
                throw new AirPlayException("The receiver sent data that did not decrypt, so the session keys differ.");
            }
            output.AddRange(plain);
            _pending.RemoveRange(0, 2 + size + TagSize);
        }
        return [.. output];
    }

    private static byte[] Nonce(ulong counter)
    {
        var nonce = new byte[12];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt64LittleEndian(nonce.AsSpan(4), counter);
        return nonce;
    }
}
