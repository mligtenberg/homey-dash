using HomeyDash.Api.Homey;

namespace HomeyDash.Api.Tests.Homey;

public class SocketIoPacketTests
{
    [Fact]
    public void Encode_EventWithAckOnNamespace()
    {
        var text = SocketIoPacket.Encode(SocketIoPacketType.Event, "/api", 7, new[] { "subscribe", "homey:manager:devices" });

        Assert.Equal("2/api,7[\"subscribe\",\"homey:manager:devices\"]", text);
    }

    [Fact]
    public void Encode_RootNamespaceHasNoPrefix()
    {
        Assert.Equal("0", SocketIoPacket.Encode(SocketIoPacketType.Connect, "/"));
        Assert.Equal("0/api,", SocketIoPacket.Encode(SocketIoPacketType.Connect, "/api"));
    }

    [Fact]
    public void Decode_AckOnRootNamespace()
    {
        var packet = SocketIoPacket.Decode("312[null,{\"namespace\":\"/api\"}]");

        Assert.Equal(SocketIoPacketType.Ack, packet.Type);
        Assert.Equal("/", packet.Namespace);
        Assert.Equal(12, packet.AckId);
        Assert.Equal("/api", packet.Data!.Value[1].GetProperty("namespace").GetString());
    }

    [Fact]
    public void Decode_EventOnNamespaceWithoutAck()
    {
        var packet = SocketIoPacket.Decode("2/api,[\"homey:device:abc\",\"capability\",{\"capabilityId\":\"onoff\",\"value\":true}]");

        Assert.Equal(SocketIoPacketType.Event, packet.Type);
        Assert.Equal("/api", packet.Namespace);
        Assert.Null(packet.AckId);
        Assert.Equal("homey:device:abc", packet.Data!.Value[0].GetString());
    }

    [Theory]
    [InlineData("0/api", "/api")]
    [InlineData("0/api,", "/api")]
    [InlineData("0", "/")]
    public void Decode_ConnectWithOrWithoutTrailingComma(string text, string ns)
    {
        var packet = SocketIoPacket.Decode(text);

        Assert.Equal(SocketIoPacketType.Connect, packet.Type);
        Assert.Equal(ns, packet.Namespace);
        Assert.Null(packet.Data);
    }
}
