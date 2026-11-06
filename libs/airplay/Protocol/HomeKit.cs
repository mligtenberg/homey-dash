using System.Security.Cryptography;
using HomeyDash.AirPlay.Crypto;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace HomeyDash.AirPlay.Protocol;

/// <summary>The Ed25519 and X25519 operations HomeKit pairing needs.</summary>
internal static class Keys
{
    public static byte[] SigningPublic(byte[] seed) => new Ed25519PrivateKeyParameters(seed).GeneratePublicKey().GetEncoded();

    public static byte[] Sign(byte[] seed, byte[] message)
    {
        var signer = new Ed25519Signer();
        signer.Init(true, new Ed25519PrivateKeyParameters(seed));
        signer.BlockUpdate(message, 0, message.Length);
        return signer.GenerateSignature();
    }

    public static bool Verify(byte[] publicKey, byte[] message, byte[] signature)
    {
        var signer = new Ed25519Signer();
        signer.Init(false, new Ed25519PublicKeyParameters(publicKey));
        signer.BlockUpdate(message, 0, message.Length);
        return signer.VerifySignature(signature);
    }

    public static (byte[] Private, byte[] Public) NewAgreementPair()
    {
        var secret = RandomNumberGenerator.GetBytes(32);
        return (secret, new X25519PrivateKeyParameters(secret).GeneratePublicKey().GetEncoded());
    }

    public static byte[] Agree(byte[] privateKey, byte[] otherPublic)
    {
        var shared = new byte[32];
        new X25519PrivateKeyParameters(privateKey).GenerateSecret(new X25519PublicKeyParameters(otherPublic), shared, 0);
        return shared;
    }
}

/// <summary>Pair-verify: proves to the receiver that we are the paired controller and leaves a shared secret to derive session keys from.</summary>
internal static class PairVerify
{
    public static async Task<byte[]> RunAsync(Connection connection, Credentials credentials, CancellationToken ct)
    {
        var (secret, ourPublic) = Keys.NewAgreementPair();
        var first = await Pairing.Exchange(connection, "/pair-verify", Tlv8.Write((Tag.SeqNo, [1]), (Tag.PublicKey, ourPublic)), ct);
        if (!first.TryGetValue(Tag.PublicKey, out var receiverPublic) || !first.TryGetValue(Tag.EncryptedData, out var encrypted))
            throw new AirPlayException("The receiver's answer to verifying was incomplete.");

        var shared = Keys.Agree(secret, receiverPublic);
        var sessionKey = HapCrypto.Hkdf("Pair-Verify-Encrypt-Salt", "Pair-Verify-Encrypt-Info", shared);
        var inner = Tlv8.Read(HapCrypto.Open(sessionKey, "PV-Msg02", encrypted));
        if (!inner.TryGetValue(Tag.Identifier, out var identifier) || !inner.TryGetValue(Tag.Signature, out var signature))
            throw new AirPlayException("The receiver's identity was incomplete.");
        if (!identifier.SequenceEqual(credentials.ReceiverId)) throw new AirPlayException("This is not the receiver that was paired.");
        if (!Keys.Verify(credentials.ReceiverPublicKey, [.. receiverPublic, .. identifier, .. ourPublic], signature))
            throw new AirPlayException("The receiver could not prove who it is.");

        var proof = Keys.Sign(credentials.PrivateKey, [.. ourPublic, .. credentials.ClientId, .. receiverPublic]);
        var answer = Tlv8.Write((Tag.Identifier, credentials.ClientId), (Tag.Signature, proof));
        await Pairing.Exchange(connection, "/pair-verify", Tlv8.Write((Tag.SeqNo, [3]), (Tag.EncryptedData, HapCrypto.Seal(sessionKey, "PV-Msg03", answer))), ct);
        return shared;
    }
}
