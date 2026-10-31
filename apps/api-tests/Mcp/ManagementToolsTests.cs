using System.Net.Http.Json;
using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace HomeyDash.Api.Tests.Mcp;

public class ManagementToolsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<McpClient> ConnectAsync()
    {
        var transport = new HttpClientTransport(
            new HttpClientTransportOptions { Endpoint = new Uri(_client.BaseAddress!, "/mcp") }, _client);
        return await McpClient.CreateAsync(transport);
    }

    private static async Task<CallToolResult> CallAsync(McpClient mcp, string tool, object arguments) =>
        await mcp.CallToolAsync(tool, JsonSerializer.Deserialize<Dictionary<string, object?>>(JsonSerializer.Serialize(arguments)));

    private static JsonElement Json(CallToolResult result)
    {
        Assert.NotEqual(true, result.IsError);
        return JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }

    private static string Error(CallToolResult result)
    {
        Assert.True(result.IsError);
        return Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text;
    }

    private static object Draft(params object[] tiles) => new
    {
        rows = 4,
        sections = new[] { new { id = "s1", title = "Living room", tiles } },
    };

    private static object Tile(string id, string size, int column, int row) =>
        new { id, kind = "flow", size, position = new { column, row }, settings = new { target = "flow-1" } };

    [Fact]
    public async Task ItOffersTheManagementTools()
    {
        await using var mcp = await ConnectAsync();

        var tools = (await mcp.ListToolsAsync()).Select(t => t.Name).Order();

        Assert.Equal(
            ["assign_dashboard", "create_dashboard", "get_dashboard", "list_dashboards", "list_displays",
                "list_targets", "publish_dashboard", "rename_dashboard", "save_draft"],
            tools);
    }

    [Fact]
    public async Task ADashboardBuiltOverMcp_IsShownOnTheAssignedDisplay()
    {
        await using var mcp = await ConnectAsync();
        var screen = Guid.NewGuid();
        var setup = await _client.PostAsJsonAsync("/api/displays", new { name = "Hallway", screenId = screen });
        var display = (await setup.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        var dashboard = Json(await CallAsync(mcp, "create_dashboard", new { name = " Kitchen " }));
        var id = dashboard.GetProperty("id").GetString();
        Assert.Equal("Kitchen", dashboard.GetProperty("name").GetString());
        Json(await CallAsync(mcp, "save_draft", new { dashboardId = id, draft = Draft(Tile("t1", "wide", 0, 0)) }));
        Json(await CallAsync(mcp, "publish_dashboard", new { dashboardId = id }));
        var info = Json(await CallAsync(mcp, "assign_dashboard", new { displayId = display, dashboardId = id }));

        Assert.Equal(id, info.GetProperty("dashboardId").GetString());
        var shown = (await _client.GetFromJsonAsync<JsonElement>($"/api/screens/{screen}")).GetProperty("dashboards")[0];
        Assert.Equal(1, shown.GetProperty("version").GetInt32());
        var tile = shown.GetProperty("layout").GetProperty("sections")[0].GetProperty("tiles")[0];
        Assert.Equal("wide", tile.GetProperty("size").GetString());
        Assert.Equal("flow-1", tile.GetProperty("settings").GetProperty("target").GetString());
    }

    [Fact]
    public async Task ADraftThatBreaksTheLayoutRules_IsRefused()
    {
        await using var mcp = await ConnectAsync();
        var id = Json(await CallAsync(mcp, "create_dashboard", new { name = "Kitchen" })).GetProperty("id").GetString();

        var result = await CallAsync(mcp, "save_draft", new { dashboardId = id, draft = Draft(Tile("t1", "wide", 0, 0), Tile("t2", "small", 1, 0)) });

        Assert.Contains("overlaps tile t1", Error(result));
    }

    [Fact]
    public async Task OtherDashboards_CanBeAssignedOverMcp()
    {
        await using var mcp = await ConnectAsync();
        var screen = Guid.NewGuid();
        var setup = await _client.PostAsJsonAsync("/api/displays", new { name = "Hallway", screenId = screen });
        var display = (await setup.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        var ids = new List<string?>();
        foreach (var name in new[] { "Main", "Garden" })
        {
            var id = Json(await CallAsync(mcp, "create_dashboard", new { name })).GetProperty("id").GetString();
            Json(await CallAsync(mcp, "publish_dashboard", new { dashboardId = id }));
            ids.Add(id);
        }

        var info = Json(await CallAsync(mcp, "assign_dashboard", new { displayId = display, dashboardId = ids[0], otherDashboardIds = new[] { ids[1] } }));

        Assert.Equal(ids[1], info.GetProperty("otherDashboardIds")[0].GetString());
        var shown = (await _client.GetFromJsonAsync<JsonElement>($"/api/screens/{screen}")).GetProperty("dashboards");
        Assert.Equal(ids, shown.EnumerateArray().Select(d => d.GetProperty("id").GetString()).ToList());
    }

    [Fact]
    public async Task AnUnpublishedDashboard_CannotBeAssigned()
    {
        await using var mcp = await ConnectAsync();
        var setup = await _client.PostAsJsonAsync("/api/displays", new { name = "Hallway", screenId = Guid.NewGuid() });
        var display = (await setup.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        var id = Json(await CallAsync(mcp, "create_dashboard", new { name = "Kitchen" })).GetProperty("id").GetString();

        var result = await CallAsync(mcp, "assign_dashboard", new { displayId = display, dashboardId = id });

        Assert.Contains("Only a published dashboard", Error(result));
    }

    [Fact]
    public async Task ItListsHomeyTargets()
    {
        await using var mcp = await ConnectAsync();

        var flows = Json(await CallAsync(mcp, "list_targets", new { type = "flow" }));

        Assert.NotEqual(0, flows.GetArrayLength());
    }
}
