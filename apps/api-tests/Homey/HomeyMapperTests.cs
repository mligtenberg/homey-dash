using System.Text.Json;
using HomeyDash.Api.Homey;

namespace HomeyDash.Api.Tests.Homey;

public class HomeyMapperTests
{
    [Fact]
    public void Device_MapsZoneCapabilitiesAndAvailability()
    {
        var json = JsonDocument.Parse(HomeyFixtures.Devices).RootElement.GetProperty("lamp");

        var device = HomeyMapper.Device(json, new Dictionary<string, string> { ["zone-living"] = "Living room" });

        Assert.Equal("Reading lamp", device.Name);
        Assert.Equal("Living room", device.ZoneName);
        Assert.Equal("light", device.Class);
        Assert.False(device.Available);
        Assert.Equal("Out of range", device.UnavailableMessage);
        var dim = device.Capabilities["dim"];
        Assert.Equal(0.4, dim.Value.GetDouble());
        Assert.True(dim.Setable);
        Assert.Equal(1, dim.Max);
        Assert.Equal(new DateTimeOffset(2026, 10, 25, 12, 0, 0, TimeSpan.Zero), dim.LastUpdated);
    }

    [Fact]
    public void Values_ReadsCollectionsKeyedById()
    {
        var zones = HomeyMapper.ZoneNames(JsonDocument.Parse(HomeyFixtures.Zones).RootElement);

        Assert.Equal("Living room", zones["zone-living"]);
    }
}
