using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HomeyDash.Api.Homey;

namespace HomeyDash.Api.Tests.Homey;

public class HomeyApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Status_ReportsTheFakeHomeyAsConnected()
    {
        var status = await _client.GetFromJsonAsync<JsonElement>("/api/homey/status");

        Assert.Equal("connected", status.GetProperty("connection").GetString());
        Assert.True(status.GetProperty("fake").GetBoolean());
        Assert.Equal(1, status.GetProperty("accountId").GetInt32());
    }

    [Fact]
    public async Task AnAccountThatIsNotThere_IsNotFound()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/homey/devices?account=2")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PostAsync("/api/homey/flows/flow-goodnight/trigger?account=2", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await _client.PostAsync("/api/homey/flows/flow-goodnight/trigger?account=1", null)).StatusCode);
    }

    [Fact]
    public async Task Devices_ListTheirZoneAndCapabilities()
    {
        var devices = await _client.GetFromJsonAsync<JsonElement>("/api/homey/devices");

        var lamp = devices.EnumerateArray().Single(d => d.GetProperty("id").GetString() == "living-lamp");
        Assert.Equal("Living room", lamp.GetProperty("zoneName").GetString());
        Assert.Equal(0.8, lamp.GetProperty("capabilities").GetProperty("dim").GetProperty("value").GetDouble());
    }

    [Theory]
    [InlineData("lastHour")]
    [InlineData("last31Days")]
    public async Task InsightEntries_AreAscendingAndEndNow(string resolution)
    {
        var entries = await _client.GetFromJsonAsync<JsonElement>($"/api/homey/insights/entries?log=homey:device:p1-meter:measure_power&resolution={resolution}");

        var times = entries.EnumerateArray().Select(e => e.GetProperty("t").GetDateTimeOffset()).ToList();
        Assert.NotEmpty(times);
        Assert.Equal(times.OrderBy(t => t), times);
        Assert.InRange(DateTimeOffset.UtcNow - times[^1], TimeSpan.Zero, TimeSpan.FromMinutes(1));
        Assert.True(entries[0].GetProperty("v").GetDouble() > 0);
    }

    [Fact]
    public async Task InsightEntries_ExistForEveryLog()
    {
        var logs = await _client.GetFromJsonAsync<JsonElement>("/api/homey/insights");

        Assert.True(logs.GetArrayLength() > 20);
        foreach (var log in logs.EnumerateArray().Select(l => l.GetProperty("id").GetString()))
        {
            var entries = await _client.GetFromJsonAsync<JsonElement>($"/api/homey/insights/entries?log={log}&resolution=last24Hours");
            Assert.All(entries.EnumerateArray(), e => Assert.True(e.GetProperty("v").GetDouble() >= 0, log));
        }
    }

    [Fact]
    public async Task InsightEntries_RefuseAnUnknownResolutionAndLog()
    {
        var resolution = await _client.GetAsync("/api/homey/insights/entries?log=homey:device:p1-meter:measure_power&resolution=lastYear");
        var log = await _client.GetAsync("/api/homey/insights/entries?log=nope&resolution=lastHour");

        Assert.Equal(HttpStatusCode.BadRequest, resolution.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, log.StatusCode);
    }

    [Fact]
    public async Task SettingACapability_UpdatesTheDeviceAndRaisesAChange()
    {
        var state = ((Homeys)factory.Services.GetService(typeof(Homeys))!).Require(null).State;
        HomeyChange? change = null;
        state.Changed += c => change = c;

        var response = await _client.PutAsJsonAsync("/api/homey/devices/washer/capabilities/onoff", new { value = true });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var device = Assert.IsType<DeviceChanged>(change).Device;
        Assert.True(device.Capabilities["onoff"].Value.GetBoolean());
        Assert.True(state.FindDevice("washer")!.Capabilities["onoff"].Value.GetBoolean());
    }

    [Theory]
    [InlineData("/api/homey/devices/nope/capabilities/onoff")]
    [InlineData("/api/homey/devices/washer/capabilities/nope")]
    public async Task SettingAnUnknownTarget_IsNotFound(string url)
    {
        var response = await _client.PutAsJsonAsync(url, new { value = true });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task SettingAReadOnlyCapability_IsRejected()
    {
        var response = await _client.PutAsJsonAsync("/api/homey/devices/p1-meter/capabilities/measure_power", new { value = 0 });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task FlowsAndMoods_CanBeStartedOnlyWhenTheyExist()
    {
        Assert.Equal(HttpStatusCode.NoContent, (await _client.PostAsync("/api/homey/flows/flow-goodnight/trigger", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await _client.PostAsync("/api/homey/moods/mood-movie/activate", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PostAsync("/api/homey/flows/nope/trigger", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PostAsync("/api/homey/moods/nope/activate", null)).StatusCode);
    }
}
