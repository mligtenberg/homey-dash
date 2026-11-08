using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Weather;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;

namespace HomeyDash.Api.Tests.Weather;

// Against FakeHomey, which is in Utrecht, and FakeWeather.
public sealed class WeatherApiTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private readonly HttpClient _client = factory.CreateClient();
    private HubConnection? _hub;

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (_hub is not null) await _hub.DisposeAsync();
    }

    // Long polling, because the in-memory test server has no WebSockets for the SignalR client.
    private async Task<HubConnection> ConnectAsync()
    {
        _hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "api/realtime"), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        await _hub.StartAsync();
        return _hub;
    }

    [Fact]
    public async Task Forecasts_GiveTheWeatherWhereEachHomeyIs()
    {
        var hub = await ConnectAsync();

        var deadline = DateTime.UtcNow.AddSeconds(5);
        JsonElement forecast;
        while ((forecast = (await hub.InvokeAsync<JsonElement>("Forecasts"))[0]).GetProperty("status").GetString() != "connected")
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("The weather did not load within 5 seconds");
            await Task.Delay(50);
        }

        Assert.Equal(1, forecast.GetProperty("accountId").GetInt32());
        Assert.Equal("Utrecht", forecast.GetProperty("place").GetString());
        Assert.Equal(52.09, forecast.GetProperty("location").GetProperty("latitude").GetDouble());
        Assert.Equal(5.12, forecast.GetProperty("location").GetProperty("longitude").GetDouble());
        Assert.Equal(3, forecast.GetProperty("now").GetProperty("code").GetInt32());
        Assert.Equal(24, forecast.GetProperty("hours").GetArrayLength());
        Assert.Equal(7, forecast.GetProperty("days").GetArrayLength());
        Assert.Equal(25, forecast.GetProperty("rain").GetArrayLength());
    }

    [Fact]
    public async Task APlaceChosenInADraft_GetsAForecastOfItsOwn_UntilNoTileHasIt()
    {
        var hub = await ConnectAsync();
        var created = await _client.PostAsJsonAsync("/api/dashboards", new { name = "Weather places" });
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        object Draft(params object[] tiles) => new { rows = 4, sections = new[] { new { id = "s", title = "", tiles } } };
        var barcelona = new
        {
            id = "w", kind = "weather", size = "small", position = new { column = 0, row = 0 },
            settings = new { target = "weather:place", place = new { name = "Barcelona", latitude = 41.389, longitude = 2.159 } },
        };

        (await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft", Draft(barcelona))).EnsureSuccessStatusCode();

        var forecast = await EventuallyAsync(hub, all => all.Cast<JsonElement?>().FirstOrDefault(f => f is { } e &&
            e.GetProperty("placeKey").GetString() == "41.39,2.16" && e.GetProperty("status").GetString() == "connected"));
        Assert.Equal("Barcelona", forecast.GetProperty("place").GetString());
        Assert.Equal(JsonValueKind.Null, forecast.GetProperty("accountId").ValueKind);
        // Buienradar doesn't know Spain.
        Assert.Equal(JsonValueKind.Null, forecast.GetProperty("rain").ValueKind);

        (await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft", Draft())).EnsureSuccessStatusCode();

        await EventuallyAsync(hub, all => all.Any(f => f.GetProperty("placeKey").ValueKind == JsonValueKind.String) ? null : (JsonElement?)all[0]);
        await _client.DeleteAsync($"/api/dashboards/{id}");
    }

    [Fact]
    public async Task Places_AreFoundByName()
    {
        var places = await _client.GetFromJsonAsync<JsonElement>("/api/weather/places?query=amers&language=nl");

        Assert.Equal(["Utrecht", "Mpumalanga"], places.EnumerateArray().Select(p => p.GetProperty("region").GetString()));
        Assert.Equal(0, (await _client.GetFromJsonAsync<JsonElement>("/api/weather/places?query=a")).GetArrayLength());
    }

    // Asks for the forecasts until `found` finds what it looks for.
    private static async Task<JsonElement> EventuallyAsync(HubConnection hub, Func<JsonElement[], JsonElement?> found)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (true)
        {
            if (found((await hub.InvokeAsync<JsonElement>("Forecasts")).EnumerateArray().ToArray()) is { } result) return result;
            if (DateTime.UtcNow > deadline) throw new TimeoutException("The forecasts did not get there within 5 seconds");
            await Task.Delay(50);
        }
    }

    [Fact]
    public void TheWeatherTarget_IsThereWhileItsHomeyIs()
    {
        var targets = factory.Services.GetRequiredService<TargetCatalog>();

        Assert.True(targets.Knows(TargetCatalog.WeatherHere));
        Assert.True(targets.Knows(TargetCatalog.WeatherHere, 1));
        Assert.False(targets.Knows(TargetCatalog.WeatherHere, 99));
        Assert.False(targets.Knows("weather:elsewhere"));
        Assert.True(targets.Knows(TargetCatalog.WeatherPlace, 99));
    }
}

public sealed class WeatherSourceTests
{
    [Fact]
    public void ParseForecast_ReadsOpenMeteosColumnsInTheLocalTime()
    {
        const string body = """
            {"utc_offset_seconds":3600,
             "current":{"time":1794137400,"temperature_2m":8.4,"apparent_temperature":6.1,"relative_humidity_2m":91,"is_day":1,
                        "weather_code":3,"wind_speed_10m":11.2,"wind_direction_10m":201,"precipitation":0.0},
             "hourly":{"time":[1794135600,1794139200],"temperature_2m":[8.2,8.6],"weather_code":[3,61],"is_day":[1,1],
                       "precipitation_probability":[21,null],"precipitation":[0.0,0.4]},
             "daily":{"time":[1794092400],"weather_code":[53],"temperature_2m_min":[5.7],"temperature_2m_max":[9.0],
                      "precipitation_probability_max":[61],"precipitation_sum":[1.2],"sunrise":[1794122640],"sunset":[1794154800]}}
            """;

        var forecast = WeatherSource.ParseForecast(body);

        Assert.Equal(new WeatherNow(8.4, 6.1, 3, true, 0.91, 11.2, 201, 0), forecast.Now);
        Assert.Equal(new WeatherHour(new DateTimeOffset(2026, 11, 8, 13, 0, 0, TimeSpan.FromHours(1)), 8.6, 61, true, 0, 0.4), forecast.Hours[1]);
        var day = Assert.Single(forecast.Days);
        Assert.Equal(new DateOnly(2026, 11, 8), day.Date);
        Assert.Equal((5.7, 9.0, 61), (day.Low, day.High, day.PrecipitationChance));
        Assert.Equal(new DateTimeOffset(2026, 11, 8, 8, 24, 0, TimeSpan.FromHours(1)), day.Sunrise);
    }

    [Fact]
    public void ParseForecast_ThatIsNotOpenMeteos_Fails() =>
        Assert.Throws<WeatherException>(() => WeatherSource.ParseForecast("""{"error":true,"reason":"Latitude must be in range"}"""));

    [Fact]
    public void ParseRain_TurnsIntensityIntoMillimetres_AcrossMidnight()
    {
        // 23:57 in Amsterdam.
        var now = new DateTimeOffset(2026, 11, 8, 22, 57, 0, TimeSpan.Zero);

        var rain = WeatherSource.ParseRain("000|23:55\n109|00:00\n077|00:05\n", now)!;

        Assert.Equal(
            [
                new RainPoint(new DateTimeOffset(2026, 11, 8, 23, 55, 0, TimeSpan.FromHours(1)), 0),
                new RainPoint(new DateTimeOffset(2026, 11, 9, 0, 0, 0, TimeSpan.FromHours(1)), 1),
                new RainPoint(new DateTimeOffset(2026, 11, 9, 0, 5, 0, TimeSpan.FromHours(1)), 0.1),
            ],
            rain);
    }

    [Fact]
    public void ParseRain_OutsideBuienradarsMap_IsUnknown() =>
        Assert.Null(WeatherSource.ParseRain("", DateTimeOffset.UtcNow));

    [Fact]
    public void ParsePlaces_ReadsOpenMeteosGeocoding()
    {
        var places = WeatherSource.ParsePlaces("""
            {"results":[{"name":"Amersfoort","latitude":52.155,"longitude":5.3875,"country":"Nederland","admin1":"Utrecht"},
                        {"name":"Amersfoort","latitude":-27.00941,"longitude":29.86643,"country":"Zuid-Afrika"}]}
            """);

        Assert.Equal([new PlaceMatch("Amersfoort", "Utrecht", "Nederland", 52.155, 5.3875), new PlaceMatch("Amersfoort", null, "Zuid-Afrika", -27.00941, 29.86643)], places);
        Assert.Empty(WeatherSource.ParsePlaces("""{"generationtime_ms":0.2}"""));
    }

    [Theory]
    [InlineData("""{"target":"weather:place","place":{"name":" Barcelona ","latitude":41.389,"longitude":2.159}}""", "Barcelona", "41.39,2.16")]
    [InlineData("""{"target":"weather:place","place":{"latitude":-33.9,"longitude":18.4}}""", "Weather", "-33.90,18.40")]
    public void APlace_IsReadFromATilesSettings(string settings, string name, string key)
    {
        var place = WeatherPlace.Of(JsonDocument.Parse(settings).RootElement);

        Assert.Equal((name, key), (place?.Name, place?.Key));
    }

    [Theory]
    [InlineData("""{"target":"weather:here","place":{"name":"Barcelona","latitude":41.389,"longitude":2.159}}""")]
    [InlineData("""{"target":"weather:place","place":{"name":"Nowhere","latitude":91,"longitude":0}}""")]
    [InlineData("""{"target":"weather:place"}""")]
    public void ATileWithoutAUsablePlace_HasNone(string settings) =>
        Assert.Null(WeatherPlace.Of(JsonDocument.Parse(settings).RootElement));

    [Theory]
    [InlineData("""{"value":{"latitude":52.09,"longitude":5.12,"accuracy":10}}""", 52.09, 5.12)]
    [InlineData("""{"lat":-33.9,"lng":18.4}""", -33.9, 18.4)]
    public void HomeyLocation_IsReadLeniently(string json, double latitude, double longitude) =>
        Assert.Equal(new HomeyLocation(latitude, longitude), HomeyMapper.Location(JsonDocument.Parse(json).RootElement));

    [Theory]
    [InlineData("""{"value":null}""")]
    [InlineData("""{"value":{"latitude":0,"longitude":0}}""")]
    public void HomeyLocation_ThatIsNotSet_IsNull(string json) =>
        Assert.Null(HomeyMapper.Location(JsonDocument.Parse(json).RootElement));
}
