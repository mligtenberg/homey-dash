using System.Text.Json;
using HomeyDash.Api.Homey;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace HomeyDash.Api.Tests.Energy;

// Trimmed from a real Homey Pro's answers to GET api/manager/energy/live and report/day (ADR-0014).
public sealed class EnergyMapperTests
{
    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    [Fact]
    public void Live_TheMeterIsTheGrid_NotTheSumOfTheDevices()
    {
        var live = HomeyMapper.EnergyLive(Json("""
            {
              "zoneName": "Thuis", "totalConsumed": { "W": 153.101, "cost": null }, "totalCumulative": { "W": 1362, "cost": null },
              "totalGenerated": { "W": null, "cost": null },
              "items": [{ "type": "cumulative", "name": "Stroomgebruik thuis", "values": { "W": 1362 } }]
            }
            """));

        Assert.Equal(new EnergyLive(Grid: 1362, Solar: null, Home: 1362), live);
    }

    [Fact]
    public void Live_WithSolar_TheHomeUsesWhatItTakesAndWhatItMakes()
    {
        var live = HomeyMapper.EnergyLive(Json("""{ "totalConsumed": { "W": 300 }, "totalCumulative": { "W": -650 }, "totalGenerated": { "W": 1830 } }"""));

        Assert.Equal(new EnergyLive(Grid: -650, Solar: 1830, Home: 1180), live);
    }

    [Fact]
    public void Live_WithoutAMeter_TheHomeIsWhatTheDevicesUse()
    {
        var live = HomeyMapper.EnergyLive(Json("""{ "totalConsumed": { "W": 420 }, "totalCumulative": { "W": null }, "totalGenerated": { "W": null } }"""));

        Assert.Equal(new EnergyLive(null, null, 420), live);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("""{ "totalConsumed": { "W": null }, "totalCumulative": { "W": null }, "totalGenerated": { "W": null }, "items": [] }""")]
    public void Live_HoldingNoPower_IsNull(string json) => Assert.Null(HomeyMapper.EnergyLive(Json(json)));

    private const string Day = """
        {
          "electricity": {
            "importedPeriod": 11.24, "exportedPeriod": 0, "generatedPeriod": null, "consumedPeriod": 0.844,
            "importedPrice": 2.9786, "exportedPrice": null,
            "devices": {
              "imported": { "a59a": { "name": "Stroomgebruik thuis", "total": 8189.346, "period": 11.24, "price": 2.9786 } },
              "consumed": {
                "07d1": { "name": "Spot", "total": 0.006, "period": 0, "price": 0, "approximatedEnergy": true },
                "129d": { "name": "Droger", "total": 6.795, "period": 0.011, "price": 0.002915 },
                "55a9": { "name": "Ensis Pendant", "total": 0.135, "period": 0.137, "price": 0.036305, "approximatedEnergy": true }
              }
            },
            "cumulativeMeasurePower": [{ "t": "2026-11-07T23:05:00.000Z", "v": 410.2 }, { "t": "2026-11-07T23:00:00.000Z", "v": 415.7 }]
          },
          "subReports": {
            "2026-11-08T00:00:00.000Z": { "electricity": { "importedPeriod": 0.333, "exportedPeriod": 0, "generatedPeriod": null, "consumedPeriod": 0.009 } },
            "2026-11-07T23:00:00.000Z": { "electricity": { "importedPeriod": 0.39, "exportedPeriod": 0, "generatedPeriod": null, "consumedPeriod": 0.02 } }
          },
          "date": "2026-11-08"
        }
        """;

    [Fact]
    public void Day_TheHomeUsesWhatCameFromTheGrid_AndCostIsWhatHomeySays()
    {
        var day = HomeyMapper.EnergyDay(Json(Day), "EUR")!;

        Assert.Equal((11.24, 0.0, (double?)null, 11.24), (day.Imported, day.Exported, day.Solar, day.Home));
        Assert.Equal((2.9786, "EUR"), (day.Cost, day.Currency));
    }

    [Fact]
    public void Day_HoursAndPowerOldestFirst()
    {
        var day = HomeyMapper.EnergyDay(Json(Day))!;

        Assert.Equal([0.39, 0.333], day.History.Select(p => p.Home));
        Assert.Equal(DateTimeOffset.Parse("2026-11-07T23:00:00Z"), day.History[0].T);
        Assert.Equal([415.7, 410.2], day.Power.Select(p => p.V));
    }

    [Fact]
    public void Day_TheDevicesThatUsedTheMostFirst_LeavingOutThoseThatUsedNone()
    {
        var day = HomeyMapper.EnergyDay(Json(Day))!;

        Assert.Equal([new EnergyUse("Ensis Pendant", 0.137), new EnergyUse("Droger", 0.011)], day.Devices);
    }

    [Fact]
    public void Day_WithSolar_TheHomeAlsoUsesWhatTheSunMade_AndExportsEarn()
    {
        var day = HomeyMapper.EnergyDay(Json("""
            { "electricity": { "importedPeriod": 4.2, "exportedPeriod": 3.1, "generatedPeriod": 9.8, "importedPrice": 1.2, "exportedPrice": 0.4 } }
            """))!;

        Assert.Equal(10.9, day.Home!.Value, 6);
        Assert.Equal(0.8, day.Cost!.Value, 6);
    }

    [Theory]
    [InlineData("""{ "foo": 1 }""")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("""{ "electricity": { "importedPeriod": null, "exportedPeriod": null, "generatedPeriod": null, "consumedPeriod": null } }""")]
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
        Assert.Equal("EUR", energy.GetProperty("day").GetProperty("currency").GetString());
        Assert.True(energy.GetProperty("day").GetProperty("devices").GetArrayLength() >= 1);
    }
}
