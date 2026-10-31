using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace HomeyDash.Api.Tests.Dashboards;

public class DashboardApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static object Draft(int rows, params object[] tiles) =>
        new { rows, sections = new[] { new { id = "s1", title = "Living room", tiles } } };

    private static object Tile(string id, string size, int column, int row) =>
        new { id, kind = "device", size, position = new { column, row }, settings = new { deviceId = "living-lamp" } };

    private async Task<string> CreateAsync(string name = "Hallway")
    {
        var response = await _client.PostAsJsonAsync("/api/dashboards", new { name });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    [Fact]
    public async Task ANewDashboard_HasAnEmptyFourRowDraftAndIsNotPublished()
    {
        var id = await CreateAsync("  Kitchen  ");

        var dashboard = await _client.GetFromJsonAsync<JsonElement>($"/api/dashboards/{id}");

        Assert.Equal("Kitchen", dashboard.GetProperty("name").GetString());
        Assert.Equal(4, dashboard.GetProperty("draft").GetProperty("rows").GetInt32());
        Assert.Equal(JsonValueKind.Null, dashboard.GetProperty("published").ValueKind);
        Assert.Equal(0, dashboard.GetProperty("publishedVersion").GetInt32());
        Assert.True(dashboard.GetProperty("hasUnpublishedChanges").GetBoolean());
    }

    [Fact]
    public async Task SavingADraft_KeepsTilesAndTheirSettings()
    {
        var id = await CreateAsync();

        var response = await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft",
            Draft(4, Tile("t1", "full-large", 0, 0), Tile("t2", "small", 2, 2)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var dashboard = await _client.GetFromJsonAsync<JsonElement>($"/api/dashboards/{id}");
        var tiles = dashboard.GetProperty("draft").GetProperty("sections")[0].GetProperty("tiles");
        Assert.Equal("full-large", tiles[0].GetProperty("size").GetString());
        Assert.Equal("living-lamp", tiles[0].GetProperty("settings").GetProperty("deviceId").GetString());
        Assert.Equal(2, tiles[1].GetProperty("position").GetProperty("column").GetInt32());
    }

    [Fact]
    public async Task ADraftWithOverlappingTiles_IsRefusedAndNotSaved()
    {
        var id = await CreateAsync();

        var response = await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft",
            Draft(4, Tile("t1", "large", 0, 0), Tile("t2", "wide", 1, 1)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("errors").TryGetProperty("sections[0].tiles[1]", out _));
        var dashboard = await _client.GetFromJsonAsync<JsonElement>($"/api/dashboards/{id}");
        Assert.Empty(dashboard.GetProperty("draft").GetProperty("sections").EnumerateArray());
    }

    [Fact]
    public async Task ADraftWithAnUnknownSize_IsRefused()
    {
        var id = await CreateAsync();

        var response = await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft", Draft(4, Tile("t1", "huge", 0, 0)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Publishing_CopiesTheDraftAndLaterDraftsDoNotTouchIt()
    {
        var id = await CreateAsync();
        await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft", Draft(4, Tile("t1", "small", 0, 0)));

        var published = await (await _client.PostAsync($"/api/dashboards/{id}/publish", null))
            .Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(1, published.GetProperty("publishedVersion").GetInt32());
        Assert.False(published.GetProperty("hasUnpublishedChanges").GetBoolean());

        await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft", Draft(3));
        var dashboard = await _client.GetFromJsonAsync<JsonElement>($"/api/dashboards/{id}");
        Assert.True(dashboard.GetProperty("hasUnpublishedChanges").GetBoolean());
        Assert.Equal(4, dashboard.GetProperty("published").GetProperty("rows").GetInt32());
        Assert.Single(dashboard.GetProperty("published").GetProperty("sections")[0].GetProperty("tiles").EnumerateArray());
    }

    [Fact]
    public async Task RenamingAndDeleting_ChangeTheList()
    {
        var id = await CreateAsync("Old name");

        var renamed = await _client.PatchAsJsonAsync($"/api/dashboards/{id}", new { name = "Bedroom" });
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        var list = await _client.GetFromJsonAsync<JsonElement>("/api/dashboards");
        Assert.Contains(list.EnumerateArray(), d => d.GetProperty("id").GetString() == id && d.GetProperty("name").GetString() == "Bedroom");

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/dashboards/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/dashboards/{id}")).StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task ADashboardWithoutAName_IsRefused(string name)
    {
        var response = await _client.PostAsJsonAsync("/api/dashboards", new { name });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task MissingTiles_CountsDraftTilesWhoseTargetHomeyDoesNotKnow()
    {
        var id = await CreateAsync();
        static object WithTarget(string id, int slot, object? target) => new
        {
            id, kind = "device", size = "small", position = new { column = slot % 3, row = slot / 3 },
            settings = target is null ? new Dictionary<string, object>() : new Dictionary<string, object> { ["target"] = target },
        };
        static object WithTargets(string id, int slot, params string[] targets) => new
        {
            id, kind = "mood-list", size = "small", position = new { column = slot % 3, row = slot / 3 },
            settings = new Dictionary<string, object?> { ["target"] = null, ["targets"] = targets },
        };

        await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft", Draft(4,
            WithTarget("known", 0, "living-lamp"), WithTarget("gone", 1, "removed-device"),
            WithTarget("unset", 2, null), WithTarget("log", 3, "homey:device:p1-meter:measure_power"),
            WithTarget("lost-log", 4, "homey:device:removed:measure_power"),
            WithTarget("weather", 5, "homey:manager:weather:temperature"),
            WithTargets("moods", 6, "mood-movie", "mood-dinner"), WithTargets("lost-mood", 7, "mood-movie", "removed-mood")));

        var list = await _client.GetFromJsonAsync<JsonElement>("/api/dashboards");
        var summary = list.EnumerateArray().Single(d => d.GetProperty("id").GetString() == id);
        Assert.Equal(3, summary.GetProperty("missingTiles").GetInt32());
        var detail = await _client.GetFromJsonAsync<JsonElement>($"/api/dashboards/{id}");
        Assert.Equal(3, detail.GetProperty("missingTiles").GetInt32());
    }

    [Fact]
    public async Task AnUnknownDashboard_IsNotFound()
    {
        var response = await _client.PostAsync($"/api/dashboards/{Guid.NewGuid()}/publish", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
