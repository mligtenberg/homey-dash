using System.Text.Json;
using HomeyDash.Api.Homey;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace HomeyDash.Api.Tests.Energy;

// The shapes below are plausible, not seen: Homey does not document its energy report (ADR-0014). Replace them with a real
// response of GET api/manager/energy/live and report/day once there is one.
public sealed class EnergyMapperTests
{
    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    [Fact]
    public void Live_GridIsWhatTheHomeUsesBeyondWhatItMakes()
    {
        var live = HomeyMapper.EnergyLive(Json("""{ "type": "live", "totalConsumed": { "W": 1450.5 }, "totalGenerated": { "W": 820 }, "items": [] }"""));

        Assert.Equal(new EnergyLive(Grid: 630.5, Solar: 820, Home: 1450.5), live);
    }

    [Fact]
    public void Live_ExportsWhenTheSunMakesMoreThanTheHomeUses()
    {
        var live = HomeyMapper.EnergyLive(Json("""{ "totalConsumed": { "W": 300 }, "totalGenerated": { "W": 2100 } }"""));

        Assert.Equal(-1800, live!.Grid);
    }

    [Fact]
    public void Live_WithoutSolarImportsAllTheHomeUses_AndPlainNumbersAndWrappingWork()
    {
        var live = HomeyMapper.EnergyLive(Json("""{ "report": { "consumed": 900 } }"""));

        Assert.Equal(new EnergyLive(900, null, 900), live);
    }

    [Fact]
    public void Live_PrefersAGridFigureHomeyGives()
    {
        var live = HomeyMapper.EnergyLive(Json("""{ "totalConsumed": 900, "totalGenerated": 100, "grid": { "W": -50 } }"""));

        Assert.Equal(-50, live!.Grid);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("""{ "items": [], "message": "no energy" }""")]
    public void Live_HoldingNoPower_IsNull(string json) => Assert.Null(HomeyMapper.EnergyLive(Json(json)));

    [Fact]
    public void Day_ReadsTotalsAndTheHistoryOldestFirst()
    {
        var day = HomeyMapper.EnergyDay(Json("""
            {
              "totalConsumed": { "kWh": 10.9 }, "totalGenerated": { "kWh": 9.8 },
              "totalImported": { "kWh": 4.2 }, "totalExported": { "kWh": 3.1 },
              "values": [
                { "t": "2026-11-08T01:00:00+01:00", "consumed": { "kWh": 0.4 }, "generated": { "kWh": 0 } },
                { "t": "2026-11-08T00:00:00+01:00", "consumed": { "kWh": 0.3 } },
                { "note": "no moment, skipped" }
              ]
            }
            """))!;

        Assert.Equal((4.2, 3.1, 9.8, 10.9), (day.Imported, day.Exported, day.Solar, day.Home));
        Assert.Equal([0.3, 0.4], day.History.Select(p => p.Home));
        Assert.Equal([null, 0], day.History.Select(p => p.Solar));
        Assert.Equal(DateTimeOffset.Parse("2026-11-08T00:00:00+01:00"), day.History[0].T);
    }

    [Fact]
    public void Day_TakesEpochSecondsAndMillisecondsAndNestedTotals()
    {
        var day = HomeyMapper.EnergyDay(Json("""
            { "totals": { "consumed": 5, "generated": 2 }, "history": [{ "time": 1794096000, "consumed": 1 }, { "time": 1794099600000, "consumed": 2 }] }
            """))!;

        Assert.Equal((5, 2), (day.Home, day.Solar));
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1794096000), day.History[0].T);
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1794099600), day.History[1].T);
    }

    [Fact]
    public void Day_TakesEpochMicrosecondsAndNanoseconds()
    {
        var day = HomeyMapper.EnergyDay(Json("""{ "history": [{ "t": 1794096000000000, "consumed": 1 }, { "t": 1794099600000000000, "consumed": 2 }] }"""))!;

        Assert.Equal([DateTimeOffset.FromUnixTimeSeconds(1794096000), DateTimeOffset.FromUnixTimeSeconds(1794099600)], day.History.Select(p => p.T));
    }

    [Fact]
    public void Day_ADateWithoutAZone_IsUtc()
    {
        var day = HomeyMapper.EnergyDay(Json("""{ "history": [{ "t": "2026-11-08T01:00:00", "consumed": 1 }] }"""))!;

        Assert.Equal(new DateTimeOffset(2026, 11, 8, 1, 0, 0, TimeSpan.Zero), day.History[0].T);
    }

    [Fact]
    public void Day_ABareList_IsTheHistory()
    {
        var day = HomeyMapper.EnergyDay(Json("""[{ "t": 1794096000, "consumed": 1 }]"""))!;

        Assert.Equal([1.0], day.History.Select(p => p.Home));
        Assert.Null(day.Home);
    }

    [Theory]
    [InlineData("""{ "foo": 1 }""")]
    [InlineData("[]")]
    [InlineData("42")]
    [InlineData("null")]
    [InlineData("""{ "history": [{ "t": -5, "consumed": 1 }] }""")]
    public void Day_HoldingNothing_IsNull(string json) => Assert.Null(HomeyMapper.EnergyDay(Json(json)));
}

// Against FakeHomey.
public sealed class EnergyApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task HomeysSnapshot_CarriesTheEnergyReport()
    {
        await using var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "api/realtime"), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        await hub.StartAsync();

        var homey = (await hub.InvokeAsync<JsonElement>("Homey"))[0];
        var energy = homey.GetProperty("energy");

        Assert.Equal("ok", energy.GetProperty("status").GetString());
        Assert.Equal(-650, energy.GetProperty("live").GetProperty("grid").GetDouble());
        Assert.Equal(1830, energy.GetProperty("live").GetProperty("solar").GetDouble());
        Assert.Equal(1180, energy.GetProperty("live").GetProperty("home").GetDouble());
        Assert.Equal(10.9, energy.GetProperty("day").GetProperty("home").GetDouble());
        Assert.True(energy.GetProperty("day").GetProperty("history").GetArrayLength() >= 1);
    }
}
