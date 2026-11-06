using HomeyDash.AirPlay.Crypto;
using HomeyDash.AirPlay.Protocol;

namespace HomeyDash.AirPlay.Tests;

// The vectors come from pyatv and srptools (Vectors/make_vectors.py): the C# has to produce the same bytes they do.
public class CryptoTests
{
    private static byte[] Hex(string hex) => Convert.FromHexString(hex);
    private static string Hex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();

    [Fact]
    public void Tlv8_WritesLongValuesInFragmentsAndReadsThemBack()
    {
        var value = Enumerable.Range(0, 300).Select(i => (byte)(i % 251)).ToArray();

        var written = Tlv8.Write((Tag.Identifier, "abc"u8.ToArray()), (Tag.PublicKey, value), (Tag.SeqNo, [5]));

        Assert.Equal(Vectors.Tlv, Hex(written));
        var read = Tlv8.Read(written);
        Assert.Equal(value, read[Tag.PublicKey]);
        Assert.Equal(new byte[] { 5 }, read[Tag.SeqNo]);
    }

    [Fact]
    public void Hkdf_MatchesPyatv()
    {
        var shared = Hex(Vectors.HkdfShared);

        Assert.Equal(Vectors.HkdfControlWrite, Hex(HapCrypto.Hkdf("Control-Salt", "Control-Write-Encryption-Key", shared)));
        Assert.Equal(Vectors.HkdfPairSetup, Hex(HapCrypto.Hkdf("Pair-Setup-Encrypt-Salt", "Pair-Setup-Encrypt-Info", shared)));
    }

    [Fact]
    public void HapStream_EncryptsInFramesLikePyatv()
    {
        var stream = new HapStream(Enumerable.Repeat((byte)1, 32).ToArray(), Enumerable.Repeat((byte)2, 32).ToArray());

        var first = stream.Encrypt(Hex(Vectors.FramePlain));
        var second = stream.Encrypt("second message"u8);

        Assert.Equal(Vectors.FrameEncrypted, Hex(first) + Hex(second));
    }

    [Fact]
    public void HapStream_DecryptsWhatArrivesInPieces()
    {
        var stream = new HapStream(Enumerable.Repeat((byte)1, 32).ToArray(), Enumerable.Repeat((byte)2, 32).ToArray());
        var encrypted = Hex(Vectors.FrameFromReceiver);

        // A frame split across reads gives nothing until it is complete.
        var output = new List<byte>();
        foreach (var chunk in encrypted.Chunk(700)) output.AddRange(stream.Decrypt(chunk));

        Assert.Equal(Hex(Vectors.FramePlain), output.ToArray());
    }

    [Fact]
    public void HapStream_RefusesTamperedData()
    {
        var stream = new HapStream(Enumerable.Repeat((byte)1, 32).ToArray(), Enumerable.Repeat((byte)2, 32).ToArray());
        var encrypted = Hex(Vectors.FrameFromReceiver);
        encrypted[10] ^= 0xFF;

        Assert.Throws<AirPlayException>(() => stream.Decrypt(encrypted));
    }

    [Fact]
    public void PairingMessages_SealLikePyatvAndOpenAgain()
    {
        var key = Enumerable.Repeat((byte)1, 32).ToArray();

        var sealedData = HapCrypto.Seal(key, "PS-Msg05", "pairing payload"u8.ToArray());

        Assert.Equal(Vectors.SealedMessage, Hex(sealedData));
        Assert.Equal("pairing payload"u8.ToArray(), HapCrypto.Open(key, "PS-Msg05", sealedData));
        Assert.Throws<AirPlayException>(() => HapCrypto.Open(key, "PS-Msg06", sealedData));
    }

    [Fact]
    public void Srp_ProducesThePublicKeySessionKeyAndProofSrptoolsDoes()
    {
        var srp = new Srp(Hex(Vectors.SrpPrivate));

        var (key, proof) = srp.Process("1234", Hex(Vectors.SrpReceiverPublic), Hex(Vectors.SrpSalt));

        Assert.Equal(Vectors.SrpPublic, Hex(srp.PublicKey));
        Assert.Equal(Vectors.SrpKey, Hex(key));
        Assert.Equal(Vectors.SrpProof, Hex(proof));
    }

    [Fact]
    public void Srp_RefusesAnInvalidReceiverKey() =>
        Assert.Throws<AirPlayException>(() => new Srp().Process("1234", new byte[384], new byte[16]));
}
