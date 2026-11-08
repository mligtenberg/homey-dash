using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HomeyDash.Api.Traffic;
using HomeyDash.Api.Weather;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace HomeyDash.Api.Tests.Traffic;

internal static class TrafficHelpers
{
    // Long polling, because the in-memory test server has no WebSockets for the SignalR client.
    public static async Task<HubConnection> ConnectAsync(ApiFactory factory)
    {
        var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "api/realtime"), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        await hub.StartAsync();
        return hub;
    }

    // Asks for the traffic until `done` says so; answers what it was then.
    public static async Task<JsonElement[]> UntilAsync(HubConnection hub, Func<JsonElement[], bool> done)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (true)
        {
            var all = (await hub.InvokeAsync<JsonElement>("Traffic")).EnumerateArray().ToArray();
            if (done(all)) return all;
            if (DateTime.UtcNow > deadline) throw new TimeoutException("The traffic did not get there within 5 seconds");
            await Task.Delay(50);
        }
    }

    public static async Task<JsonElement> EventuallyAsync(HubConnection hub, Func<JsonElement, bool> match) =>
        (await UntilAsync(hub, all => all.Any(match))).First(match);

    public static object Route(string origin = "Utrecht Centraal", double olat = 52.089, double olon = 5.110,
        string destination = "Amsterdam Centraal", double dlat = 52.379, double dlon = 4.900) => new
    {
        name = $"{origin} to {destination}",
        origin = new { name = origin, latitude = olat, longitude = olon },
        destination = new { name = destination, latitude = dlat, longitude = dlon },
    };

    public static async Task<string> DraftWithAsync(HttpClient client, string name, params object[] settings)
    {
        var created = await client.PostAsJsonAsync("/api/dashboards", new { name });
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        var tiles = settings.Select((s, i) => new
        {
            id = $"t{i}", kind = "traffic", size = "small", position = new { column = i, row = 0 }, settings = s,
        }).ToArray();
        var draft = new { rows = 4, sections = new[] { new { id = "s", title = "", tiles } } };
        (await client.PutAsJsonAsync($"/api/dashboards/{id}/draft", draft)).EnsureSuccessStatusCode();
        return id;
    }
}

// Against FakeTraffic, which has one TomTom account and 25 minutes where 18 is usual.
public sealed class TrafficApiTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private readonly HttpClient _client = factory.CreateClient();
    private HubConnection? _hub;

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (_hub is not null) await _hub.DisposeAsync();
    }

    [Fact]
    public async Task TheFakeHasOneAccount_ThatCantBeChanged()
    {
        var info = await _client.GetFromJsonAsync<JsonElement>("/api/accounts/tomtom");

        Assert.True(info.GetProperty("fake").GetBoolean());
        Assert.Equal("TomTom", info.GetProperty("accounts")[0].GetProperty("name").GetString());
        Assert.False(info.GetProperty("accounts")[0].TryGetProperty("apiKey", out _));
        Assert.Equal(HttpStatusCode.Conflict, (await _client.PostAsJsonAsync("/api/accounts/tomtom", new { name = "Work", apiKey = "k" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await _client.DeleteAsync("/api/accounts/tomtom/1")).StatusCode);
    }

    [Fact]
    public async Task Places_AreFoundByName()
    {
        var places = await _client.GetFromJsonAsync<JsonElement>("/api/traffic/places?query=ams&language=nl");

        Assert.Equal(["Amsterdam Centraal"], places.EnumerateArray().Select(p => p.GetProperty("name").GetString()));
        Assert.Equal(0, (await _client.GetFromJsonAsync<JsonElement>("/api/traffic/places?query=a")).GetArrayLength());
    }

    [Fact]
    public async Task ARouteInADraft_GetsItsTraffic_UntilNoTileHasIt()
    {
        _hub = await TrafficHelpers.ConnectAsync(factory);
        var id = await TrafficHelpers.DraftWithAsync(_client, "Traffic",
            new { target = (string?)null, route = TrafficHelpers.Route() },
            // The same route again, to the same place within 100 m: shared.
            new { target = (string?)null, route = TrafficHelpers.Route(olat: 52.0891, olon: 5.1101) });

        var traffic = await TrafficHelpers.EventuallyAsync(_hub, t => t.GetProperty("routeKey").GetString() == "52.089,5.110>52.379,4.900" && t.GetProperty("status").GetString() == "connected");

        Assert.Equal(1500, traffic.GetProperty("travelSeconds").GetInt32());
        Assert.Equal(1080, traffic.GetProperty("usualSeconds").GetInt32());
        Assert.Equal(420, traffic.GetProperty("delaySeconds").GetInt32());
        Assert.Equal(21_400, traffic.GetProperty("distanceMeters").GetInt32());
        Assert.Equal(JsonValueKind.String, traffic.GetProperty("arrival").ValueKind);
        Assert.Single((await _hub.InvokeAsync<JsonElement>("Traffic")).EnumerateArray(), t => t.GetProperty("routeKey").GetString() == "52.089,5.110>52.379,4.900");

        (await _client.DeleteAsync($"/api/dashboards/{id}")).EnsureSuccessStatusCode();
        await TrafficHelpers.UntilAsync(_hub, all => !all.Any(t => t.GetProperty("routeKey").GetString() == "52.089,5.110>52.379,4.900"));
    }

    [Fact]
    public async Task ALockWidgetsRoute_IsWatchedToo()
    {
        _hub = await TrafficHelpers.ConnectAsync(factory);
        var screen = Guid.NewGuid();
        var pairing = await _client.PostAsJsonAsync("/api/displays", new { name = "Hall", screenId = screen });
        pairing.EnsureSuccessStatusCode();
        var display = (await pairing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        var saved = await _client.PutAsJsonAsync($"/api/displays/{display}/lock-screen", new
        {
            widgets = new object[]
            {
                new { kind = "traffic", spot = "top-left", route = TrafficHelpers.Route("Jam", 52.0, 5.0, "Schiphol Airport", 52.309, 4.764) },
                new { kind = "traffic", spot = "top-right" },
            },
        });

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var traffic = await TrafficHelpers.EventuallyAsync(_hub, t => t.GetProperty("routeKey").GetString() == "52.000,5.000>52.309,4.764" && t.GetProperty("status").GetString() == "connected");
        Assert.Equal(2700, traffic.GetProperty("travelSeconds").GetInt32());
        Assert.Equal(1620, traffic.GetProperty("delaySeconds").GetInt32());
    }

    [Fact]
    public async Task ATrafficWidget_NeedsAUsableRoute_AndOnlyTrafficHasOne()
    {
        var pairing = await _client.PostAsJsonAsync("/api/displays", new { name = "Study", screenId = Guid.NewGuid() });
        var display = (await pairing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        Task<HttpResponseMessage> Save(object widget) => _client.PutAsJsonAsync($"/api/displays/{display}/lock-screen", new { widgets = new[] { widget } });

        // Both places the same.
        Assert.Equal(HttpStatusCode.BadRequest, (await Save(new { kind = "traffic", spot = "center", route = TrafficHelpers.Route("A", 52, 5, "B", 52, 5) })).StatusCode);
        // A place without a name.
        Assert.Equal(HttpStatusCode.BadRequest, (await Save(new { kind = "traffic", spot = "center", route = TrafficHelpers.Route("", 52, 5, "B", 53, 5) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save(new { kind = "clock", spot = "center", route = TrafficHelpers.Route() })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Save(new { kind = "traffic", spot = "center", account = 1, route = TrafficHelpers.Route() })).StatusCode);
    }
}

// Against the real TomTom client, with no account set up.
public sealed class RealTrafficApiFactory : ApiFactory
{
    protected override bool FakeTraffic => false;
}

public sealed class WithoutATomTomAccountTests(RealTrafficApiFactory factory) : IClassFixture<RealTrafficApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task WithoutAnAccount_PlacesCantBeFound_AndARoutesTrafficSaysSo()
    {
        var info = await _client.GetFromJsonAsync<JsonElement>("/api/accounts/tomtom");
        Assert.False(info.GetProperty("fake").GetBoolean());
        Assert.Equal(0, info.GetProperty("accounts").GetArrayLength());
        Assert.Equal(HttpStatusCode.Conflict, (await _client.GetAsync("/api/traffic/places?query=ams")).StatusCode);

        await using var hub = await TrafficHelpers.ConnectAsync(factory);
        var id = await TrafficHelpers.DraftWithAsync(_client, "No TomTom", new { target = (string?)null, route = TrafficHelpers.Route() });
        var traffic = await TrafficHelpers.EventuallyAsync(hub, t => t.GetProperty("status").GetString() == "noAccount");

        Assert.Equal(JsonValueKind.Null, traffic.GetProperty("travelSeconds").ValueKind);
        await _client.DeleteAsync($"/api/dashboards/{id}");
    }

    [Fact]
    public async Task AccountsNeedANameAndAKey()
    {
        var response = await _client.PostAsJsonAsync("/api/accounts/tomtom", new { name = "", apiKey = "" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.True(errors.TryGetProperty("name", out _));
        Assert.True(errors.TryGetProperty("apiKey", out _));
    }
}

public sealed class TomTomClientTests
{
    [Fact]
    public void ParseRoute_ReadsTheSummary_WithTheHistoryAsTheUsualTime()
    {
        const string body = """
            {"routes":[{"summary":{"lengthInMeters":21400,"travelTimeInSeconds":1500,"trafficDelayInSeconds":300,
             "noTrafficTravelTimeInSeconds":1200,"historicTrafficTravelTimeInSeconds":1320,"liveTrafficIncidentsTravelTimeInSeconds":1500,
             "departureTime":"2026-11-08T17:30:00+01:00","arrivalTime":"2026-11-08T17:55:00+01:00"}}]}
            """;

        var route = TomTomClient.ParseRoute(body);

        Assert.Equal(new RouteTime(1500, 1320, 21400, new DateTimeOffset(2026, 11, 8, 17, 55, 0, TimeSpan.FromHours(1))), route);
    }

    [Fact]
    public void ParseRoute_WithoutHistory_UsesTheFreeFlowTime() =>
        Assert.Equal(1200, TomTomClient.ParseRoute("""
            {"routes":[{"summary":{"lengthInMeters":9000,"travelTimeInSeconds":1500,"noTrafficTravelTimeInSeconds":1200,
             "arrivalTime":"2026-11-08T17:55:00+01:00"}}]}
            """).UsualSeconds);

    [Fact]
    public void ParseRoute_ThatIsNotARoute_Fails() =>
        Assert.Throws<TrafficException>(() => TomTomClient.ParseRoute("""{"routes":[]}"""));

    [Fact]
    public void ParsePlaces_NamesAPoiByItsNameAndAnAddressByItsStreet()
    {
        var places = TomTomClient.ParsePlaces("""
            {"results":[
              {"poi":{"name":"Utrecht Centraal"},"address":{"municipality":"Utrecht","countrySubdivision":"Utrecht","country":"Netherlands","freeformAddress":"Stationsplein, Utrecht"},"position":{"lat":52.0894,"lon":5.1100}},
              {"address":{"streetName":"Oudegracht","streetNumber":"1","municipality":"Utrecht","country":"Netherlands"},"position":{"lat":52.0907,"lon":5.1214}},
              {"address":{"municipality":"Utrecht","country":"Netherlands"},"position":{"lat":52.09,"lon":5.12}}]}
            """);

        Assert.Equal(
            [
                new PlaceMatch("Utrecht Centraal", "Utrecht, Utrecht", "Netherlands", 52.0894, 5.11),
                new PlaceMatch("Oudegracht 1", "Utrecht", "Netherlands", 52.0907, 5.1214),
                new PlaceMatch("Utrecht", null, "Netherlands", 52.09, 5.12),
            ],
            places);
        Assert.Empty(TomTomClient.ParsePlaces("""{"summary":{"numResults":0}}"""));
    }

    [Theory]
    [InlineData("""{"name":"Work","origin":{"name":"Home","latitude":52.089,"longitude":5.11},"destination":{"name":"Office","latitude":52.379,"longitude":4.9}}""", "52.089,5.110>52.379,4.900")]
    public void ARoute_IsReadFromATilesSettings(string route, string key)
    {
        var settings = JsonDocument.Parse($$"""{"target":null,"route":{{route}}}""").RootElement;

        Assert.Equal(key, TrafficRoute.Of(settings)?.Key);
    }

    [Theory]
    [InlineData("""{"target":null}""")]
    [InlineData("""{"route":{"name":"x"}}""")]
    [InlineData("""{"route":{"name":"x","origin":{"name":"A","latitude":91,"longitude":0},"destination":{"name":"B","latitude":1,"longitude":1}}}""")]
    [InlineData("""{"route":{"name":"x","origin":{"name":"A","latitude":1,"longitude":1},"destination":{"name":"A","latitude":1,"longitude":1}}}""")]
    [InlineData("""{"route":"nowhere"}""")]
    public void ATileWithoutAUsableRoute_HasNone(string settings) =>
        Assert.Null(TrafficRoute.Of(JsonDocument.Parse(settings).RootElement));
}
