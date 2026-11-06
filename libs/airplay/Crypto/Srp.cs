using System.Numerics;
using System.Security.Cryptography;
using System.Text;

namespace HomeyDash.AirPlay.Crypto;

/// <summary>
/// SRP-6a as the Apple TV's PIN pairing runs it: the 3072 bit group, SHA-512, the user name "Pair-Setup" and the PIN as password.
/// Numbers are hashed as their shortest big-endian bytes except where padded to the group's size, as the receivers expect.
/// </summary>
internal sealed class Srp
{
    private static readonly BigInteger N = BigInteger.Parse("0" +
        "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
        "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
        "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
        "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
        "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
        "15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7" +
        "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C" +
        "BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF",
        System.Globalization.NumberStyles.HexNumber);
    private static readonly BigInteger G = 5;

    /// <summary>The 3072 bit group's prime, for the tests' receiver to share.</summary>
    internal static BigInteger Prime => N;
    private static readonly int Width = Bytes(N).Length;

    private readonly BigInteger _a;
    private readonly BigInteger _publicA;

    public Srp(byte[]? privateKey = null)
    {
        _a = new BigInteger(privateKey ?? RandomNumberGenerator.GetBytes(32), isUnsigned: true, isBigEndian: true);
        _publicA = BigInteger.ModPow(G, _a, N);
    }

    public byte[] PublicKey => Bytes(_publicA);

    /// <summary>The shared key K and our proof M1, from the receiver's public key and salt.</summary>
    public (byte[] Key, byte[] Proof) Process(string pin, byte[] receiverPublic, byte[] salt)
    {
        var b = new BigInteger(receiverPublic, isUnsigned: true, isBigEndian: true);
        if (b % N == 0) throw new AirPlayException("The receiver sent an invalid pairing key.");

        var k = HashInt(Bytes(N), Pad(G));
        var u = HashInt(Pad(_publicA), Pad(b));
        var x = HashInt(salt, Hash(Encoding.UTF8.GetBytes("Pair-Setup:" + pin)));
        var v = BigInteger.ModPow(G, x, N);
        var baseValue = ((b - k * v) % N + N) % N;
        var premaster = BigInteger.ModPow(baseValue, _a + u * x, N);
        var key = Hash(Bytes(premaster));

        var hashN = HashInt(Bytes(N));
        var hashG = HashInt(Bytes(G));
        var proof = Hash(Bytes(hashN ^ hashG), Bytes(HashInt(Encoding.UTF8.GetBytes("Pair-Setup"))), salt, Bytes(_publicA), Bytes(b), key);
        return (key, proof);
    }

    private static byte[] Bytes(BigInteger value) => value.IsZero ? [0] : value.ToByteArray(isUnsigned: true, isBigEndian: true);

    private static byte[] Pad(BigInteger value)
    {
        var bytes = Bytes(value);
        var padded = new byte[Width];
        bytes.CopyTo(padded, Width - bytes.Length);
        return padded;
    }

    private static byte[] Hash(params byte[][] parts) => SHA512.HashData(parts.SelectMany(p => p).ToArray());

    private static BigInteger HashInt(params byte[][] parts) => new(Hash(parts), isUnsigned: true, isBigEndian: true);
}
