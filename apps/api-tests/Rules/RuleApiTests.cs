using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace HomeyDash.Api.Tests.Rules;

public sealed class RuleApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static object Rule(params object[] conditions) => new { match = "all", conditions };

    private static object When(string signal, string op, object? value = null, bool not = false) =>
        new { signal, @operator = op, value, not };

    private static object Held(string kind, object settings) => new { kind, settings };

    private static object LogicTile(string id, object entries, object? fallback = null) => new
    {
        id, kind = "logic", size = "wide", position = new { column = 0, row = 0 },
        settings = new { target = (string?)null, entries, fallback, minShowSeconds = 0 },
    };

    private static object Draft(params object[] tiles) => new { rows = 4, sections = new[] { new { id = "s1", title = "Hall", tiles } } };

    private async Task<string> CreateDashboardAsync()
    {
        var created = await _client.PostAsJsonAsync("/api/dashboards", new { name = "Hall" });
        return (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    private async Task<JsonElement> SignalAsync(string id) =>
        (await _client.GetFromJsonAsync<JsonElement>("/api/rules/signals")).EnumerateArray().Single(s => s.GetProperty("id").GetString() == id);

    [Fact]
    public async Task TheSignalCatalogue_ListsSignalsWithWhatHelpsWriteConditions()
    {
        var target = await SignalAsync("homey:1:capability:thermostat:target_temperature");
        var alarm = await SignalAsync("homey:1:capability:hall-alarm:homealarm_state");
        var door = await SignalAsync("homey:1:capability:dining-garden-door:alarm_contact");
        var mode = await SignalAsync("homey:1:variable:var-house-mode");
        var now = await SignalAsync("clock:now");
        var touched = await SignalAsync("display:touched");

        Assert.Equal(("homey", "number", "Target temperature", "Thermostat", 1, "Fake Homey"),
            (target.GetProperty("source").GetString(), target.GetProperty("type").GetString(), target.GetProperty("name").GetString(),
                target.GetProperty("group").GetString(), target.GetProperty("account").GetInt32(), target.GetProperty("accountName").GetString()));
        Assert.Equal(("°C", 5, 30), (target.GetProperty("unit").GetString(), target.GetProperty("min").GetDouble(), target.GetProperty("max").GetDouble()));
        Assert.Equal("text", alarm.GetProperty("type").GetString());
        Assert.Contains(alarm.GetProperty("allowedValues").EnumerateArray(), v => v.GetProperty("value").GetString() == "partially_armed");
        Assert.Equal(("open", "closed"), (door.GetProperty("trueLabel").GetString(), door.GetProperty("falseLabel").GetString()));
        Assert.Equal(("text", "Variables"), (mode.GetProperty("type").GetString(), mode.GetProperty("group").GetString()));
        Assert.Equal("dateTime", now.GetProperty("type").GetString());
        Assert.Equal("display", touched.GetProperty("source").GetString());
    }

    [Fact]
    public async Task TheDisplayNameSignal_OffersEveryDisplay()
    {
        var setup = await _client.PostAsJsonAsync("/api/displays", new { name = "Attic", screenId = Guid.NewGuid() });
        var display = (await setup.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        var name = await SignalAsync("display:name");

        Assert.Contains(name.GetProperty("allowedValues").EnumerateArray(),
            v => v.GetProperty("value").GetString() == display && v.GetProperty("label").GetString() == "Attic");
    }

    [Fact]
    public async Task ThePreviewEndpoint_EvaluatesRulesOnce_AsOnAChosenDisplay()
    {
        var setup = await _client.PostAsJsonAsync("/api/displays", new { name = "Garage", screenId = Guid.NewGuid() });
        var display = (await setup.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        var rules = new Dictionary<string, object>
        {
            ["here"] = Rule(When("display:name", "equals", display)),
            ["locked"] = Rule(When("homey:1:capability:front-door:locked", "isTrue")),
        };

        var asGarage = await _client.PostAsJsonAsync("/api/rules/evaluate", new { rules, display });
        var asNone = await _client.PostAsJsonAsync("/api/rules/evaluate", new { rules, display = (string?)null });

        Assert.Equal(new Dictionary<string, bool> { ["here"] = true, ["locked"] = true }, await asGarage.Content.ReadFromJsonAsync<Dictionary<string, bool>>());
        Assert.Equal(new Dictionary<string, bool> { ["here"] = false, ["locked"] = true }, await asNone.Content.ReadFromJsonAsync<Dictionary<string, bool>>());
    }

    [Fact]
    public async Task ThePreviewEndpoint_RefusesInvalidRules()
    {
        var response = await _client.PostAsJsonAsync("/api/rules/evaluate",
            new { rules = new Dictionary<string, object> { ["bad"] = Rule(When("clock:now", "isTrue")) } });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.Contains("doesn't suit a date and time signal", errors.GetProperty("rules.bad.conditions[0]")[0].GetString());
    }

    [Fact]
    public async Task ThePreviewEndpoint_SaysWhereInAGroupARuleIsWrong()
    {
        var group = new { match = "all", conditions = new[] { When("clock:now", "onWeekdays", new[] { "monday" }), When("clock:now", "isTrue") } };
        var empty = new { match = "any", conditions = Array.Empty<object>() };
        var response = await _client.PostAsJsonAsync("/api/rules/evaluate",
            new { rules = new Dictionary<string, object> { ["bad"] = Rule(group, empty) } });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.Contains("doesn't suit a date and time signal", errors.GetProperty("rules.bad.conditions[0].conditions[1]")[0].GetString());
        Assert.Equal("A group needs at least one condition.", errors.GetProperty("rules.bad.conditions[1].conditions")[0].GetString());
    }

    [Fact]
    public async Task ADraftWithAValidLogicTile_IsSaved()
    {
        var id = await CreateDashboardAsync();
        var entries = new[]
        {
            new { tile = Held("device", new { target = "thermostat" }), rule = Rule(When("homey:1:capability:thermostat:measure_temperature", "lessThan", 18)) },
            new { tile = Held("plex-now-playing", new { target = "plex-player:any" }), rule = Rule(When("plex:1:any", "equals", "playing")) },
        };

        var response = await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft", Draft(LogicTile("t1", entries, Held("photo", new { target = (string?)null }))));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var saved = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("draft").GetProperty("sections")[0].GetProperty("tiles")[0];
        Assert.Equal(2, saved.GetProperty("settings").GetProperty("entries").GetArrayLength());
    }

    [Fact]
    public async Task ADraftWithAnInvalidRule_IsRefusedSayingWhere()
    {
        var id = await CreateDashboardAsync();
        var entries = new object[]
        {
            new { tile = Held("flow", new { target = "flow-goodnight" }), rule = Rule(When("clock:now", "after", "2026-12-24T18:00:00+01:00")) },
            new { tile = Held("flow", new { target = "flow-goodnight" }), rule = Rule(When("homey:1:capability:front-door:locked", "equals", true)) },
            new { tile = Held("flow", new { target = "flow-goodnight" }) },
        };

        var response = await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft", Draft(LogicTile("t1", entries)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.Contains("doesn't suit a yes/no signal", errors.GetProperty("sections[0].tiles[0].settings.entries[1].rule.conditions[0]")[0].GetString());
        Assert.Contains("needs a rule", errors.GetProperty("sections[0].tiles[0].settings.entries[2].rule")[0].GetString());
        Assert.False(errors.TryGetProperty("sections[0].tiles[0].settings.entries[0].rule.conditions[0]", out _));
    }

    [Fact]
    public async Task ALogicTileOnAMissingSignalOrHoldingAMissingTarget_IsFlagged()
    {
        var id = await CreateDashboardAsync();
        var fine = new[] { new { tile = Held("flow", new { target = "flow-goodnight" }), rule = Rule(When("homey:1:variable:var-guests", "isTrue")) } };
        var gone = new[] { new { tile = Held("flow", new { target = "flow-goodnight" }), rule = Rule(When("homey:1:variable:var-removed", "isTrue")) } };
        var lost = new[] { new { tile = Held("flow", new { target = "flow-removed" }), rule = Rule(When("homey:1:variable:var-guests", "isTrue")) } };
        var tiles = new[] { LogicTile("fine", fine), LogicTile("gone", gone), LogicTile("lost", lost) }
            .Select((t, i) => JsonSerializer.SerializeToElement(t) is var json
                ? JsonSerializer.Deserialize<Dictionary<string, object>>(json.GetRawText())! is var tile && (tile["position"] = new { column = 0, row = i }) is not null ? tile : tile
                : null)
            .ToArray();

        var response = await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft", Draft(tiles!));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("missingTiles").GetInt32());
    }
}
