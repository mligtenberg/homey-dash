using HomeyDash.AirPlay.Protocol;

namespace HomeyDash.AirPlay.Tests;

public class MiscTests
{
    [Theory]
    [InlineData("AppleTV14,1", "0x4A7FDFD5,0x3C155FDE", "tv")]
    [InlineData("AppleTV6,2", "0x5A7FFFF7,0x1E", "tv")]
    [InlineData("HomePod1,1", "0x4A7FCA00,0x3C155FDE", "speaker")]
    [InlineData("MacBookPro18,3", "0x4A7FDFD5,0x3C155FDE", "computer")]
    [InlineData("iMac21,1", "0x4A7FDFD5", "computer")]
    [InlineData(null, null, "speaker")]
    [InlineData("QN90", "garbage", "speaker")]
    public void Kind_IsATvOnlyWhenTheReceiverTakesVideo(string? model, string? features, string kind) =>
        Assert.Equal(kind, Receiver.KindOf(model, features));

    [Fact]
    public void Credentials_RoundTripThroughTheTextPyatvUses()
    {
        var text = "0102:0304:0506:0708";

        var credentials = Credentials.Parse(text);

        Assert.Equal(new byte[] { 1, 2 }, credentials.ReceiverPublicKey);
        Assert.Equal(new byte[] { 3, 4 }, credentials.PrivateKey);
        Assert.Equal(new byte[] { 5, 6 }, credentials.ReceiverId);
        Assert.Equal(new byte[] { 7, 8 }, credentials.ClientId);
        Assert.Equal(text, credentials.ToString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("zz:zz:zz:zz")]
    [InlineData("0102:0304")]
    public void Credentials_ThatCannotBeRead_AskToPairAgain(string text) =>
        Assert.Contains("Pair the receiver again", Assert.Throws<AirPlayException>(() => Credentials.Parse(text)).Message);

    [Fact]
    public void TimingServer_AnswersWithTheRequestsSendTimeAndItsOwnClock()
    {
        var request = new byte[32];
        request[0] = 0x80;
        request[1] = 0xD2;
        for (var i = 24; i < 32; i++) request[i] = (byte)i;

        var answer = TimingServer.Answer(request, 0x1122334455667788);

        Assert.Equal(0x80, answer[0]);
        Assert.Equal(0xD3, answer[1]);
        Assert.Equal(request[24..32], answer[8..16]);
        Assert.Equal(Convert.FromHexString("1122334455667788"), answer[16..24]);
        Assert.Equal(Convert.FromHexString("1122334455667788"), answer[24..32]);
    }

    [Fact]
    public void TimingServer_CountsTimeFrom1900()
    {
        var seconds = TimingServer.Now() >> 32;

        // 2208988800 seconds from 1900 to 1970; 2026 is a bit over 56 years later.
        Assert.InRange(seconds, 2208988800UL + 56UL * 365 * 86400, 2208988800UL + 70UL * 365 * 86400);
    }

    [Fact]
    public void Discovery_ReadsAnAnswerFromAnAppleTv()
    {
        var instances = new Dictionary<string, Discovery.Instance>(StringComparer.OrdinalIgnoreCase);
        var addresses = new Dictionary<string, HashSet<System.Net.IPAddress>>(StringComparer.OrdinalIgnoreCase);

        Discovery.Collect(DiscoveryPacket.AppleTvAnswer(), instances, addresses);

        var receiver = Assert.Single(Discovery.Resolve(instances, addresses));
        Assert.Equal("B2:19:DD:A9:4C:0D", receiver.Id);
        Assert.Equal("Living Room", receiver.Name);
        Assert.Equal("192.168.1.23", receiver.Address.ToString());
        Assert.Equal(7000, receiver.Port);
        Assert.Equal("tv", receiver.Kind);
    }
}
