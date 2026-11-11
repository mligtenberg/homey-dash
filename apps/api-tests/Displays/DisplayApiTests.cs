using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace HomeyDash.Api.Tests.Displays;

public class DisplayApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<string> SetUpAsync(Guid screen, string name = "Hallway")
    {
        var response = await _client.PostAsJsonAsync("/api/displays", new { name, screenId = screen });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    private async Task<string> DashboardAsync(bool publish, string name = "Kitchen")
    {
        var created = await _client.PostAsJsonAsync("/api/dashboards", new { name });
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        if (publish) await _client.PostAsync($"/api/dashboards/{id}/publish", null);
        return id;
    }

    private Task<HttpResponseMessage> AssignAsync(string display, params string[] dashboards) =>
        _client.PutAsJsonAsync($"/api/displays/{display}/dashboards", new { dashboardIds = dashboards });

    private static List<string?> DisplayDashboards(JsonElement view) =>
        view.GetProperty("display").GetProperty("dashboardIds").EnumerateArray().Select(i => i.GetString()).ToList();

    private async Task<JsonElement> ViewAsync(Guid screen) =>
        await (await ScreenAsync(screen)).Content.ReadFromJsonAsync<JsonElement>();

    private static List<string?> Ids(JsonElement dashboards) =>
        dashboards.EnumerateArray().Select(d => d.GetProperty("id").GetString()).ToList();

    private Task<HttpResponseMessage> ScreenAsync(Guid screen) => _client.GetAsync($"/api/screens/{screen}");

    [Fact]
    public async Task AnUnknownScreen_IsSentToSetup()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await ScreenAsync(Guid.NewGuid())).StatusCode);
    }

    [Fact]
    public async Task ANewDisplay_WaitsForADashboard()
    {
        var screen = Guid.NewGuid();
        var id = await SetUpAsync(screen, "  Hallway  ");

        var view = await (await ScreenAsync(screen)).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(id, view.GetProperty("display").GetProperty("id").GetString());
        Assert.Equal("Hallway", view.GetProperty("display").GetProperty("name").GetString());
        Assert.Equal(0, view.GetProperty("dashboards").GetArrayLength());
    }

    [Fact]
    public async Task AnAssignedDisplay_ShowsThePublishedVersion()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var dashboard = await DashboardAsync(publish: true);
        await _client.PutAsJsonAsync($"/api/dashboards/{dashboard}/draft", new { rows = 6, sections = Array.Empty<object>() });

        Assert.Equal(HttpStatusCode.OK, (await AssignAsync(display, dashboard)).StatusCode);

        var shown = (await ViewAsync(screen)).GetProperty("dashboards").EnumerateArray().Single();
        Assert.Equal(dashboard, shown.GetProperty("id").GetString());
        Assert.Equal(1, shown.GetProperty("version").GetInt32());
        Assert.Equal(4, shown.GetProperty("layout").GetProperty("rows").GetInt32()); // not the draft's 6
    }

    [Fact]
    public async Task ANeverPublishedDashboard_CannotBeAssigned()
    {
        var display = await SetUpAsync(Guid.NewGuid());
        var dashboard = await DashboardAsync(publish: false);

        Assert.Equal(HttpStatusCode.BadRequest, (await AssignAsync(display, dashboard)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await AssignAsync(display, Guid.NewGuid().ToString())).StatusCode);
    }

    [Fact]
    public async Task Takeover_MovesTheDisplayAndSendsThePreviousScreenToSetup()
    {
        var (oldScreen, newScreen) = (Guid.NewGuid(), Guid.NewGuid());
        var display = await SetUpAsync(oldScreen, "Kitchen wall");
        var dashboard = await DashboardAsync(publish: true);
        await AssignAsync(display, dashboard);

        var response = await _client.PostAsJsonAsync($"/api/displays/{display}/takeover", new { screenId = newScreen });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ScreenAsync(oldScreen)).StatusCode);
        var view = await (await ScreenAsync(newScreen)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(display, view.GetProperty("display").GetProperty("id").GetString());
        Assert.Equal("Kitchen wall", view.GetProperty("display").GetProperty("name").GetString());
        Assert.Equal([dashboard], Ids(view.GetProperty("dashboards")));
    }

    [Fact]
    public async Task AScreen_HoldsOneDisplayAtATime()
    {
        var screen = Guid.NewGuid();
        var first = await SetUpAsync(screen, "First");
        var second = await SetUpAsync(Guid.NewGuid(), "Second");

        await _client.PostAsJsonAsync($"/api/displays/{second}/takeover", new { screenId = screen });

        var view = await (await ScreenAsync(screen)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(second, view.GetProperty("display").GetProperty("id").GetString());
        var list = await _client.GetFromJsonAsync<JsonElement>("/api/displays");
        Assert.Contains(list.EnumerateArray(), d => d.GetProperty("id").GetString() == first);
    }

    [Fact]
    public async Task DeletingADashboard_MakesItsDisplaysWait()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var dashboard = await DashboardAsync(publish: true);
        await AssignAsync(display, dashboard);

        await _client.DeleteAsync($"/api/dashboards/{dashboard}");

        var view = await ViewAsync(screen);
        Assert.Equal(0, view.GetProperty("dashboards").GetArrayLength());
        Assert.Empty(DisplayDashboards(view));
    }

    [Fact]
    public async Task ADisplay_OffersItsDashboardsInOrder()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var (main, garden, kids) = (await DashboardAsync(true, "Main"), await DashboardAsync(true, "Garden"), await DashboardAsync(true, "Kids"));

        // A dashboard is offered once.
        Assert.Equal(HttpStatusCode.OK, (await AssignAsync(display, main, kids, main, garden, kids)).StatusCode);

        var view = await ViewAsync(screen);
        Assert.Equal([main, kids, garden], Ids(view.GetProperty("dashboards")));
        Assert.Equal([main, kids, garden], DisplayDashboards(view));

        await AssignAsync(display, garden, main);
        Assert.Equal([garden, main], Ids((await ViewAsync(screen)).GetProperty("dashboards")));
    }

    [Fact]
    public async Task EveryDashboard_NeedsAPublishedVersion()
    {
        var display = await SetUpAsync(Guid.NewGuid());
        var (published, draft) = (await DashboardAsync(publish: true), await DashboardAsync(publish: false));

        Assert.Equal(HttpStatusCode.OK, (await AssignAsync(display)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await AssignAsync(display, published, draft)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await AssignAsync(display, published, Guid.NewGuid().ToString())).StatusCode);
    }

    [Fact]
    public async Task DeletingADashboard_LeavesTheOthersInOrder()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var (main, garden, kids) = (await DashboardAsync(true, "Main"), await DashboardAsync(true, "Garden"), await DashboardAsync(true, "Kids"));
        await AssignAsync(display, main, garden, kids);

        await _client.DeleteAsync($"/api/dashboards/{main}");
        Assert.Equal([garden, kids], Ids((await ViewAsync(screen)).GetProperty("dashboards")));

        await _client.DeleteAsync($"/api/dashboards/{kids}");
        var view = await ViewAsync(screen);
        Assert.Equal([garden], Ids(view.GetProperty("dashboards")));
        Assert.Equal([garden], DisplayDashboards(view));
    }

    [Fact]
    public async Task RenamingAndRemoving_ChangeTheDisplay()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen, "Old");

        Assert.Equal(HttpStatusCode.OK, (await _client.PatchAsJsonAsync($"/api/displays/{display}", new { name = "Bedroom" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PatchAsJsonAsync($"/api/displays/{display}", new { name = " " })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/displays/{display}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ScreenAsync(screen)).StatusCode);
    }

    [Fact]
    public async Task SetupWithoutANameOrScreen_IsRefused()
    {
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _client.PostAsJsonAsync("/api/displays", new { name = "", screenId = Guid.NewGuid() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _client.PostAsJsonAsync("/api/displays", new { name = "Hall", screenId = Guid.Empty })).StatusCode);
    }

    private static object Weekend() => new
    {
        match = "all",
        conditions = new[] { new { signal = "clock:now", @operator = "onWeekdays", value = new[] { "saturday", "sunday" } } },
    };

    private Task<HttpResponseMessage> IdleRulesAsync(string display, params object[] rules) =>
        _client.PutAsJsonAsync($"/api/displays/{display}/idle-rules", new { rules });

    [Fact]
    public async Task IdleRules_ReachTheScreenInOrder()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var (main, garden, kids) = (await DashboardAsync(true, "Main"), await DashboardAsync(true, "Garden"), await DashboardAsync(true, "Kids"));
        await AssignAsync(display, main, garden, kids);

        var saved = await IdleRulesAsync(display, new { dashboardId = kids, rule = Weekend() }, new { dashboardId = garden, rule = Weekend() });

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var rules = (await ViewAsync(screen)).GetProperty("display").GetProperty("idleRules");
        Assert.Equal([kids, garden], rules.EnumerateArray().Select(r => r.GetProperty("dashboardId").GetString()).ToList());
        Assert.Equal("onWeekdays", rules[0].GetProperty("rule").GetProperty("conditions")[0].GetProperty("operator").GetString());
    }

    [Fact]
    public async Task IdleRules_OnlyShowOfferedDashboardsByValidRules()
    {
        var display = await SetUpAsync(Guid.NewGuid());
        var (main, elsewhere) = (await DashboardAsync(true, "Main"), await DashboardAsync(true, "Elsewhere"));
        await AssignAsync(display, main);

        Assert.Equal(HttpStatusCode.BadRequest, (await IdleRulesAsync(display, new { dashboardId = elsewhere, rule = Weekend() })).StatusCode);
        var invalid = new { match = "all", conditions = new[] { new { signal = "clock:now", @operator = "isTrue" } } };
        Assert.Equal(HttpStatusCode.BadRequest, (await IdleRulesAsync(display, new { dashboardId = main, rule = invalid })).StatusCode);
    }

    [Fact]
    public async Task ADashboardNoLongerOffered_LosesItsIdleRule()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var (main, garden, kids) = (await DashboardAsync(true, "Main"), await DashboardAsync(true, "Garden"), await DashboardAsync(true, "Kids"));
        await AssignAsync(display, main, garden, kids);
        await IdleRulesAsync(display, new { dashboardId = garden, rule = Weekend() }, new { dashboardId = kids, rule = Weekend() });

        await AssignAsync(display, main, kids);
        await _client.DeleteAsync($"/api/dashboards/{kids}");

        Assert.Equal(0, (await ViewAsync(screen)).GetProperty("display").GetProperty("idleRules").GetArrayLength());
    }

    private async Task<string> PhotoSetAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/photo-sets", new { name = "Summer", albumId = HomeyDash.Api.Photos.FakeImmich.SummerId });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    [Fact]
    public async Task AnIdleRule_CanPlayAPhotoSet_AndGoBackToADashboard()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var (main, garden) = (await DashboardAsync(true, "Main"), await DashboardAsync(true, "Garden"));
        await AssignAsync(display, main, garden);
        var set = await PhotoSetAsync();

        var saved = await IdleRulesAsync(display,
            new { photoSetId = set, rule = Weekend() },
            new { photoSetId = set, rule = Weekend(), returnDashboardId = garden });

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var rules = (await ViewAsync(screen)).GetProperty("display").GetProperty("idleRules");
        Assert.Equal(set, rules[0].GetProperty("photoSetId").GetString());
        Assert.Equal(JsonValueKind.Null, rules[0].GetProperty("returnDashboardId").ValueKind);
        Assert.Equal(garden, rules[1].GetProperty("returnDashboardId").GetString());
    }

    [Fact]
    public async Task APhotoSetIdleRule_NeedsAKnownSetAndAnOfferedDashboardToGoBackTo()
    {
        var display = await SetUpAsync(Guid.NewGuid());
        var (main, elsewhere) = (await DashboardAsync(true, "Main"), await DashboardAsync(true, "Elsewhere"));
        await AssignAsync(display, main);
        var set = await PhotoSetAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await IdleRulesAsync(display, new { photoSetId = Guid.NewGuid(), rule = Weekend() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await IdleRulesAsync(display, new { photoSetId = set, rule = Weekend(), returnDashboardId = elsewhere })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await IdleRulesAsync(display, new { photoSetId = set, dashboardId = main, rule = Weekend() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await IdleRulesAsync(display, new { rule = Weekend() })).StatusCode);
    }

    [Fact]
    public async Task AnIdleRule_CanFillWithAColour_AndGoBackToADashboard()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var (main, garden) = (await DashboardAsync(true, "Main"), await DashboardAsync(true, "Garden"));
        await AssignAsync(display, main, garden);

        var saved = await IdleRulesAsync(display, new { color = "#1a2B3c", rule = Weekend(), returnDashboardId = garden });

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var rule = (await ViewAsync(screen)).GetProperty("display").GetProperty("idleRules").EnumerateArray().Single();
        Assert.Equal("#1a2B3c", rule.GetProperty("color").GetString());
        Assert.Equal(garden, rule.GetProperty("returnDashboardId").GetString());
    }

    [Fact]
    public async Task AColourIdleRule_NeedsAHexColourAndDoesOneThing()
    {
        var display = await SetUpAsync(Guid.NewGuid());
        var main = await DashboardAsync(true, "Main");
        await AssignAsync(display, main);
        var set = await PhotoSetAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await IdleRulesAsync(display, new { color = "black", rule = Weekend() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await IdleRulesAsync(display, new { color = "#000", rule = Weekend() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await IdleRulesAsync(display, new { color = "#000000", dashboardId = main, rule = Weekend() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await IdleRulesAsync(display, new { color = "#000000", photoSetId = set, rule = Weekend() })).StatusCode);
    }

    [Fact]
    public async Task ADashboardNoLongerOffered_SendsAPhotoSetBackToTheLastShown()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var (main, garden) = (await DashboardAsync(true, "Main"), await DashboardAsync(true, "Garden"));
        await AssignAsync(display, main, garden);
        var set = await PhotoSetAsync();
        await IdleRulesAsync(display, new { photoSetId = set, rule = Weekend(), returnDashboardId = garden });

        await AssignAsync(display, main);

        var rule = (await ViewAsync(screen)).GetProperty("display").GetProperty("idleRules").EnumerateArray().Single();
        Assert.Equal(set, rule.GetProperty("photoSetId").GetString());
        Assert.Equal(JsonValueKind.Null, rule.GetProperty("returnDashboardId").ValueKind);
    }

    private Task<HttpResponseMessage> LockScreenAsync(string display, params object[] widgets) =>
        _client.PutAsJsonAsync($"/api/displays/{display}/lock-screen", new { widgets });

    [Fact]
    public async Task LockWidgets_ReachTheScreenInOrder()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);

        var saved = await LockScreenAsync(display,
            new { kind = "clock", spot = "center" },
            new { kind = "weather", spot = "top-right", account = 1 },
            new { kind = "value", spot = "bottom-left", signal = "homey:1:capability:thermostat:measure_temperature" });

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var widgets = (await ViewAsync(screen)).GetProperty("display").GetProperty("lockWidgets");
        Assert.Equal(["clock", "weather", "value"], widgets.EnumerateArray().Select(w => w.GetProperty("kind").GetString()).ToList());
        Assert.Equal("top-right", widgets[1].GetProperty("spot").GetString());
        Assert.Equal("homey:1:capability:thermostat:measure_temperature", widgets[2].GetProperty("signal").GetString());
    }

    [Fact]
    public async Task ALanguage_ReachesTheScreen_AndOnlyASupportedOneIsAccepted()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var put = (string? language) => _client.PutAsJsonAsync($"/api/displays/{display}/language", new { language });

        Assert.Equal(HttpStatusCode.OK, (await put("nl")).StatusCode);
        Assert.Equal("nl", (await ViewAsync(screen)).GetProperty("display").GetProperty("language").GetString());

        Assert.Equal(HttpStatusCode.BadRequest, (await put("klingon")).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await put(null)).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await ViewAsync(screen)).GetProperty("display").GetProperty("language").ValueKind);
    }

    [Fact]
    public async Task ALightSource_ReachesTheScreen_AndOnlyADeviceCapabilityIsAccepted()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var put = (string? signal) => _client.PutAsJsonAsync($"/api/displays/{display}/light-source", new { signal });

        Assert.Equal(HttpStatusCode.OK, (await put("homey:1:capability:thermostat:measure_temperature")).StatusCode);
        Assert.Equal("homey:1:capability:thermostat:measure_temperature",
            (await ViewAsync(screen)).GetProperty("display").GetProperty("lightSignal").GetString());

        Assert.Equal(HttpStatusCode.BadRequest, (await put("homey:1:capability:nowhere:measure_luminance")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await put("display:brightness")).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await put(null)).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await ViewAsync(screen)).GetProperty("display").GetProperty("lightSignal").ValueKind);
    }

    [Fact]
    public async Task ALockWidget_CanBeHiddenOrRuled_AndAnInvalidRuleIsRefused()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var weekend = new { match = "all", conditions = new[] { new { signal = "clock:now", @operator = "onWeekdays", value = new[] { "saturday", "sunday" } } } };

        var saved = await LockScreenAsync(display,
            new { kind = "clock", spot = "center", hidden = true },
            new { kind = "clock", spot = "top-left", rule = weekend });

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var widgets = (await ViewAsync(screen)).GetProperty("display").GetProperty("lockWidgets");
        Assert.True(widgets[0].GetProperty("hidden").GetBoolean());
        Assert.Equal("clock:now", widgets[1].GetProperty("rule").GetProperty("conditions")[0].GetProperty("signal").GetString());

        var invalid = new { match = "all", conditions = new[] { new { signal = "clock:now", @operator = "isTrue" } } };
        Assert.Equal(HttpStatusCode.BadRequest, (await LockScreenAsync(display, new { kind = "clock", spot = "center", rule = invalid })).StatusCode);
    }

    [Fact]
    public async Task ALockWidget_NeedsAKnownKindSpotAndCapability()
    {
        var display = await SetUpAsync(Guid.NewGuid());

        Assert.Equal(HttpStatusCode.BadRequest, (await LockScreenAsync(display, new { kind = "radio", spot = "center" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await LockScreenAsync(display, new { kind = "clock", spot = "middle" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await LockScreenAsync(display, new { kind = "value", spot = "center" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await LockScreenAsync(display, new { kind = "value", spot = "center", signal = "homey:1:capability:nowhere:onoff" })).StatusCode);
        // A variable is a signal too, but not a device's value.
        Assert.Equal(HttpStatusCode.BadRequest,
            (await LockScreenAsync(display, new { kind = "value", spot = "center", signal = "homey:1:variable:var-guests" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await LockScreenAsync(display, Enumerable.Repeat<object>(new { kind = "clock", spot = "center" }, 9).ToArray())).StatusCode);
    }
}
