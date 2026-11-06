using System.Security.Cryptography;
using System.Text;

namespace HomeyDash.AirPlay;

/// <summary>
/// What pairing leaves: our long-term Ed25519 key pair (ltsk is its seed), the receiver's public key and the ids each side
/// goes by. The text form is four hex fields joined by colons, the same pyatv keeps, so existing pairings keep working.
/// </summary>
public sealed class Credentials(byte[] receiverPublicKey, byte[] privateKey, byte[] receiverId, byte[] clientId)
{
    public byte[] ReceiverPublicKey { get; } = receiverPublicKey;
    public byte[] PrivateKey { get; } = privateKey;
    public byte[] ReceiverId { get; } = receiverId;
    public byte[] ClientId { get; } = clientId;

    public static Credentials Parse(string text)
    {
        var fields = text.Trim().Split(':');
        try
        {
            if (fields.Length == 4) return new Credentials(Convert.FromHexString(fields[0]), Convert.FromHexString(fields[1]), Convert.FromHexString(fields[2]), Convert.FromHexString(fields[3]));
        }
        catch (FormatException)
        {
        }
        throw new AirPlayException("The saved pairing is not in a form HomeyDash understands. Pair the receiver again.");
    }

    public override string ToString() =>
        string.Join(':', new[] { ReceiverPublicKey, PrivateKey, ReceiverId, ClientId }.Select(b => Convert.ToHexString(b).ToLowerInvariant()));

    internal static byte[] NewClientId() => Encoding.ASCII.GetBytes(Guid.NewGuid().ToString().ToUpperInvariant());

    internal static byte[] NewSeed() => RandomNumberGenerator.GetBytes(32);
}
