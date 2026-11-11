using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HomeyDash.Api.AirPlay;

namespace HomeyDash.Api.Tests.AirPlay;

// Management's AirPlay panel, against FakeAirPlay: the living room TV is paired, the bedroom TV is not.
public sealed class AirPlayAccountsApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<JsonElement> StatusAsync(HttpClient? client = null) =>
        await (client ?? _client).GetFromJsonAsync<JsonElement>("/api/accounts/airplay");

    [Fact]
    public async Task TheStatus_ListsTheReceiversAndWhichArePaired()
    {
        var status = await StatusAsync();

        Assert.True(status.GetProperty("configured").GetBoolean());
        Assert.True(status.GetProperty("fake").GetBoolean());
        Assert.True(status.GetProperty("reachable").GetBoolean());
        var paired = status.GetProperty("devices").EnumerateArray().ToDictionary(d => d.GetProperty("id").GetString()!, d => d.GetProperty("paired").GetBoolean());
        Assert.True(paired[FakeAirPlay.LivingRoomTv]);
        Assert.False(paired["fake-bedroom"]);
    }

    [Fact]
    public async Task Renaming_ShowsTheNewNameAndAnEmptyNameGoesBack()
    {
        var renamed = await _client.PutAsJsonAsync("/api/accounts/airplay/fake-speaker/name", new { name = " Study speaker " });
        var name = (await StatusAsync()).GetProperty("devices").EnumerateArray().First(d => d.GetProperty("id").GetString() == "fake-speaker").GetProperty("name").GetString();
        await _client.PutAsJsonAsync("/api/accounts/airplay/fake-speaker/name", new { name = "" });
        var reset = (await StatusAsync()).GetProperty("devices").EnumerateArray().First(d => d.GetProperty("id").GetString() == "fake-speaker").GetProperty("name").GetString();

        Assert.Equal(HttpStatusCode.NoContent, renamed.StatusCode);
        Assert.Equal("Study speaker", name);
        Assert.Equal("Kitchen speaker", reset);
    }

    [Fact]
    public async Task Pairing_TakesThePinTheReceiverShows()
    {
        var start = await _client.PostAsync("/api/accounts/airplay/fake-bedroom/pair", null);
        var wrong = await _client.PostAsJsonAsync("/api/accounts/airplay/fake-bedroom/pair/finish", new { pin = "12" });
        var empty = await _client.PostAsJsonAsync("/api/accounts/airplay/fake-bedroom/pair/finish", new { pin = " " });
        var right = await _client.PostAsJsonAsync("/api/accounts/airplay/fake-bedroom/pair/finish", new { pin = "1234" });

        Assert.Equal(HttpStatusCode.NoContent, start.StatusCode);
        Assert.Equal(HttpStatusCode.BadGateway, wrong.StatusCode);
        Assert.Contains("PIN", await wrong.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, right.StatusCode);
        var bedroom = (await StatusAsync()).GetProperty("devices").EnumerateArray().Single(d => d.GetProperty("id").GetString() == "fake-bedroom");
        Assert.True(bedroom.GetProperty("paired").GetBoolean());
    }

    [Fact]
    public async Task WithoutTheService_TheStatusSaysItIsNotSetUp()
    {
        await using var off = new NoAirPlayApiFactory();
        var client = off.CreateClient();

        var status = await StatusAsync(client);
        var pair = await client.PostAsync("/api/accounts/airplay/any/pair", null);

        Assert.False(status.GetProperty("configured").GetBoolean());
        Assert.Equal(0, status.GetProperty("devices").GetArrayLength());
        Assert.Equal(HttpStatusCode.Conflict, pair.StatusCode);
    }
}
