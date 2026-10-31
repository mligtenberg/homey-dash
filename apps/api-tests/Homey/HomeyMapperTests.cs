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
    public void Mood_MapsTheColoursOfTheLightsItTurnsOn()
    {
        var mood = HomeyMapper.Mood(JsonDocument.Parse(HomeyFixtures.Moods).RootElement.GetProperty("m1"));

        // A colour light, then a white one whose hue its temperature mode ignores; the light off and the plug have none.
        Assert.Equal([new HomeyLightColor(0.6, 0.8, null), new HomeyLightColor(null, null, 1)], mood.Colors);
    }

    [Fact]
    public void Values_ReadsCollectionsKeyedById()
    {
        var zones = HomeyMapper.Values(JsonDocument.Parse(HomeyFixtures.Zones).RootElement).Select(HomeyMapper.Zone).ToList();

        Assert.Equal([new HomeyZone("zone-home", "Home", null), new HomeyZone("zone-living", "Living room", "zone-home")], zones);
    }

    [Fact]
    public void Flow_MapsItsFolder()
    {
        var flow = HomeyMapper.Flow(JsonDocument.Parse(HomeyFixtures.Flows).RootElement.GetProperty("f1"), advanced: false);
        var folder = HomeyMapper.FlowFolder(JsonDocument.Parse(HomeyFixtures.FlowFolders).RootElement.GetProperty("ff1"));

        Assert.Equal("ff1", flow.FolderId);
        Assert.Equal(new HomeyFlowFolder("ff1", "Evening", null), folder);
    }
}
