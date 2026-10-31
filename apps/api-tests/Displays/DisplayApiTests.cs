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

    private Task<HttpResponseMessage> AssignAsync(string display, string? dashboard, params string[] others) =>
        _client.PutAsJsonAsync($"/api/displays/{display}/dashboard", new { dashboardId = dashboard, otherDashboardIds = others });

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
        Assert.Equal(JsonValueKind.Null, view.GetProperty("display").GetProperty("dashboardId").ValueKind);
    }

    [Fact]
    public async Task ADisplay_OffersItsMainDashboardFirstAndThenTheOthersInOrder()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var (main, garden, kids) = (await DashboardAsync(true, "Main"), await DashboardAsync(true, "Garden"), await DashboardAsync(true, "Kids"));

        // The main one is left out of the others, and a dashboard is offered once.
        Assert.Equal(HttpStatusCode.OK, (await AssignAsync(display, main, kids, main, garden, kids)).StatusCode);

        var view = await ViewAsync(screen);
        Assert.Equal([main, kids, garden], Ids(view.GetProperty("dashboards")));
        Assert.Equal(main, view.GetProperty("display").GetProperty("dashboardId").GetString());
        Assert.Equal([kids, garden], view.GetProperty("display").GetProperty("otherDashboardIds").EnumerateArray().Select(i => i.GetString()));

        await AssignAsync(display, garden, main);
        Assert.Equal([garden, main], Ids((await ViewAsync(screen)).GetProperty("dashboards")));
    }

    [Fact]
    public async Task OtherDashboards_NeedAMainOneAndAPublishedVersion()
    {
        var display = await SetUpAsync(Guid.NewGuid());
        var (published, draft) = (await DashboardAsync(publish: true), await DashboardAsync(publish: false));

        Assert.Equal(HttpStatusCode.BadRequest, (await AssignAsync(display, null, published)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await AssignAsync(display, published, draft)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await AssignAsync(display, published, Guid.NewGuid().ToString())).StatusCode);
    }

    [Fact]
    public async Task DeletingAMainDashboard_MakesTheNextOneMain()
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
        Assert.Equal(garden, view.GetProperty("display").GetProperty("dashboardId").GetString());
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
}
