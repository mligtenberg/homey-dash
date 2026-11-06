using HomeyDash.AirPlay.Crypto;
using HomeyDash.AirPlay.Protocol;

namespace HomeyDash.AirPlay;

/// <summary>
/// Pair-setup: the receiver shows a PIN and we trade keys with it (SRP then Ed25519), once. Start makes the PIN appear,
/// Finish takes it and returns the credentials to keep.
/// </summary>
public sealed class Pairing : IDisposable
{
    private readonly Connection _connection;
    private readonly byte[] _seed = Credentials.NewSeed();
    private readonly byte[] _clientId = Credentials.NewClientId();
    private readonly byte[] _receiverSalt;
    private readonly byte[] _receiverPublic;

    private Pairing(Connection connection, byte[] salt, byte[] publicKey)
    {
        _connection = connection;
        _receiverSalt = salt;
        _receiverPublic = publicKey;
    }

    public static async Task<Pairing> StartAsync(Receiver receiver, CancellationToken ct)
    {
        var connection = await Connection.ConnectAsync(receiver.Address, receiver.Port, ct);
        try
        {
            // This is what makes the receiver show its PIN.
            await connection.PostAsync("/pair-pin-start", [], ct);
            var reply = await Exchange(connection, "/pair-setup", Tlv8.Write((Tag.Method, [0]), (Tag.SeqNo, [1])), ct);
            if (!reply.TryGetValue(Tag.Salt, out var salt) || !reply.TryGetValue(Tag.PublicKey, out var publicKey))
                throw new AirPlayException("The receiver didn't start pairing.");
            return new Pairing(connection, salt, publicKey);
        }
        catch
        {
            connection.Dispose();
            throw;
        }
    }

    public async Task<Credentials> FinishAsync(string pin, CancellationToken ct)
    {
        var srp = new Srp();
        var (key, proof) = srp.Process(pin, _receiverPublic, _receiverSalt);

        await Exchange(_connection, "/pair-setup", Tlv8.Write((Tag.SeqNo, [3]), (Tag.PublicKey, srp.PublicKey), (Tag.Proof, proof)), ct);

        var controllerKey = HapCrypto.Hkdf("Pair-Setup-Controller-Sign-Salt", "Pair-Setup-Controller-Sign-Info", key);
        var sessionKey = HapCrypto.Hkdf("Pair-Setup-Encrypt-Salt", "Pair-Setup-Encrypt-Info", key);
        var publicKey = Keys.SigningPublic(_seed);
        var signature = Keys.Sign(_seed, [.. controllerKey, .. _clientId, .. publicKey]);
        var inner = Tlv8.Write((Tag.Identifier, _clientId), (Tag.PublicKey, publicKey), (Tag.Signature, signature), (Tag.Name, OpackName("HomeyDash")));

        var reply = await Exchange(_connection, "/pair-setup", Tlv8.Write((Tag.SeqNo, [5]), (Tag.EncryptedData, HapCrypto.Seal(sessionKey, "PS-Msg05", inner))), ct);
        if (!reply.TryGetValue(Tag.EncryptedData, out var encrypted)) throw new AirPlayException("The receiver didn't finish pairing.");

        var receiver = Tlv8.Read(HapCrypto.Open(sessionKey, "PS-Msg06", encrypted));
        if (!receiver.TryGetValue(Tag.Identifier, out var receiverId) || !receiver.TryGetValue(Tag.PublicKey, out var receiverKey))
            throw new AirPlayException("The receiver's pairing answer was incomplete.");
        return new Credentials(receiverKey, _seed, receiverId, _clientId);
    }

    // The name the receiver lists the pairing under: the OPACK dictionary {"name": ...}.
    internal static byte[] OpackName(string name)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(name);
        return [0xE1, 0x44, .. "name"u8.ToArray(), (byte)(0x40 + bytes.Length), .. bytes];
    }

    /// <summary>Sends one pairing message; the receiver reports a refused PIN or a busy state in an error field.</summary>
    internal static async Task<Dictionary<byte, byte[]>> Exchange(Connection connection, string uri, byte[] body, CancellationToken ct)
    {
        var response = await connection.PostAsync(uri, body, ct);
        var reply = Tlv8.Read(response.Body);
        if (reply.TryGetValue(Tag.Error, out var error)) throw PairingError(error.Length > 0 ? error[0] : (byte)1, uri);
        return reply;
    }

    private static AirPlayException PairingError(byte code, string uri) => code switch
    {
        2 when uri == "/pair-verify" => new AirPlayException("The receiver doesn't know this pairing any more. Pair it again."),
        2 => new AirPlayException("The receiver didn't accept that PIN."),
        3 => new AirPlayException("The receiver has had too many attempts. Wait a minute and try again."),
        4 => new AirPlayException("The receiver can't remember more pairings."),
        5 => new AirPlayException("The receiver has had too many wrong PINs and locked pairing for now."),
        6 or 7 => new AirPlayException("The receiver is busy. Try again in a moment."),
        _ => new AirPlayException($"The receiver refused pairing (error {code})."),
    };

    public void Dispose() => _connection.Dispose();
}
