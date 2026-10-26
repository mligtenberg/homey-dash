using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Realtime;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol;
using ModelContextProtocol.Server;

namespace HomeyDash.Api.Mcp;

/// <summary>
/// What Management does, offered to AI assistants over MCP: building dashboards and assigning them to displays.
/// Each tool follows the same rules as its endpoint and tells screens and Management just the same.
/// </summary>
[McpServerToolType]
public sealed class ManagementTools(HomeyDashDbContext db, HomeyState homey, RealtimeNotifier notifier, DisplayPresence presence, TimeProvider time)
{
    public const string Path = "/mcp";

    // Arguments and results read and write dashboards as the API does. The SDK needs a resolver set explicitly.
    public static JsonSerializerOptions Json { get; } = new(Dashboard.Json) { TypeInfoResolver = new DefaultJsonTypeInfoResolver() };

    // Mirrors CORE_TILES in libs/tiles/src/lib/core/core-tiles.ts; the API itself never looks inside settings (ADR-0003).
    private const string TileKinds = """
        Tile kinds, with the sizes each supports and the target type its settings.target takes:
        - "device" (small, wide, large): a device; optional settings.capability picks the capability shown (absent: automatic).
        - "flow" (small, wide): a flow, started when pressed.
        - "mood" (small, wide): a mood, activated when pressed.
        - "statistic" (large, full-large): an insight log, charted; optional settings.window is lastHour, last24Hours (default), last7Days or last31Days.
        Every tile's settings may have a "label" that overrides its target's name.
        """;

    [McpServerTool(Name = "list_dashboards", ReadOnly = true)]
    [Description("Lists all dashboards with their publish state, whether the draft has unpublished changes, and how many tiles point at something Homey does not know.")]
    public Task<List<DashboardSummary>> ListDashboards(CancellationToken ct) => DashboardEndpoints.ListAsync(db, homey, ct);

    [McpServerTool(Name = "get_dashboard", ReadOnly = true)]
    [Description("Gets a dashboard with its draft and published layouts.")]
    public async Task<DashboardDetail> GetDashboard(Guid dashboardId, CancellationToken ct) =>
        (await FindDashboardAsync(dashboardId, ct)).ToDetail(homey);

    [McpServerTool(Name = "create_dashboard")]
    [Description("Creates a dashboard with an empty draft of 4 rows. Fill it with save_draft and make it showable with publish_dashboard.")]
    public async Task<DashboardDetail> CreateDashboard([Description("At most 100 characters.")] string name, CancellationToken ct)
    {
        Refuse(DashboardValidator.ValidateName(name));
        var dashboard = new Dashboard { Name = name.Trim() };
        db.Dashboards.Add(dashboard);
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        return dashboard.ToDetail(homey);
    }

    [McpServerTool(Name = "rename_dashboard", Idempotent = true)]
    [Description("Renames a dashboard.")]
    public async Task<DashboardDetail> RenameDashboard(Guid dashboardId, [Description("At most 100 characters.")] string name, CancellationToken ct)
    {
        var dashboard = await FindDashboardAsync(dashboardId, ct);
        Refuse(DashboardValidator.ValidateName(name));
        dashboard.Name = name.Trim();
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        return dashboard.ToDetail(homey);
    }

    [McpServerTool(Name = "save_draft", Idempotent = true)]
    [Description($"""
        Replaces a dashboard's draft. Displays never show a draft; publish it to show it.
        A dashboard has 1 to 12 rows. Each section is a grid 3 columns wide and as many rows tall as the dashboard;
        sections sit side by side and scroll horizontally. A tile's position is the zero-based column and row of its
        top-left cell. Sizes in cells (columns×rows): small 1×1, wide 2×1, full 3×1, large 2×2, full-large 3×2.
        Tiles must stay inside their section's grid and never overlap. Section and tile ids are any unique strings.
        Find targets with list_homey_targets.
        {TileKinds}
        """)]
    public async Task<DashboardDetail> SaveDraft(Guid dashboardId, DashboardLayout draft, CancellationToken ct)
    {
        var dashboard = await FindDashboardAsync(dashboardId, ct);
        var errors = DashboardValidator.Validate(draft);
        if (errors.Count > 0)
            throw new McpException("The draft breaks the layout rules: "
                + string.Join("; ", errors.Select(e => $"{e.Key}: {string.Join(" ", e.Value)}")));
        dashboard.SaveDraft(DashboardEndpoints.WithSettings(draft));
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        return dashboard.ToDetail(homey);
    }

    [McpServerTool(Name = "publish_dashboard")]
    [Description("Makes a dashboard's draft its published version. Every display showing it switches to the new version at once.")]
    public async Task<DashboardDetail> PublishDashboard(Guid dashboardId, CancellationToken ct)
    {
        var dashboard = await FindDashboardAsync(dashboardId, ct);
        dashboard.Publish(time.GetUtcNow());
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        await notifier.ScreensChangedAsync(db, await DashboardEndpoints.ScreensShowingAsync(db, dashboardId, ct), ct);
        return dashboard.ToDetail(homey);
    }

    [McpServerTool(Name = "list_displays", ReadOnly = true)]
    [Description("Lists the displays (the screens in the home that completed setup), each with its assigned dashboard and whether it is connected and shows the latest published version.")]
    public Task<List<DisplayInfo>> ListDisplays(CancellationToken ct) => DisplayQueries.ListAsync(db, presence, ct);

    [McpServerTool(Name = "assign_dashboard", Idempotent = true)]
    [Description("Assigns a published dashboard to a display, which shows it at once. Without a dashboard id the display waits for one.")]
    public async Task<DisplayInfo> AssignDashboard(Guid displayId, Guid? dashboardId = null, CancellationToken ct = default)
    {
        if (await db.Displays.FindAsync([displayId], ct) is not { } display)
            throw new McpException($"Display {displayId} not found.");
        if (dashboardId is { } id && (await FindDashboardAsync(id, ct)).Published is null)
            throw new McpException("Only a published dashboard can be assigned.");

        if (display.DashboardId != dashboardId) display.ShownVersion = null;
        display.DashboardId = dashboardId;
        await db.SaveChangesAsync(ct);
        await notifier.ScreensChangedAsync(db, [display.ScreenId], ct);
        return await DisplayQueries.InfoAsync(db, presence, display, ct);
    }

    public sealed record Target(string Id, string Name, string? Detail);

    [McpServerTool(Name = "list_homey_targets", ReadOnly = true)]
    [Description("Lists what tiles can point at in Homey: their ids go in a tile's settings.target. A device's detail lists its capability ids, for a device tile's settings.capability.")]
    public async Task<IEnumerable<Target>> ListHomeyTargets(
        [Description("device, flow, mood or insight")] string type, IHomey homeyActions, CancellationToken ct) =>
        type switch
        {
            "device" => homey.Devices.OrderBy(d => d.Name).Select(d =>
                new Target(d.Id, d.Name, $"{d.Class} in {d.ZoneName ?? "no zone"}; capabilities: {string.Join(", ", d.Capabilities.Keys)}")),
            "flow" => homey.Flows.OrderBy(f => f.Name).Select(f => new Target(f.Id, f.Name, f.Enabled ? null : "turned off")),
            "mood" => homey.Moods.OrderBy(m => m.Name).Select(m => new Target(m.Id, m.Name, null)),
            "insight" => (await InsightLogsAsync(homeyActions, ct)).Select(l =>
                new Target(l.Id, string.Join(" · ", new[] { l.OwnerName, l.Title }.OfType<string>()), l.Units)),
            _ => throw new McpException($"Unknown target type {type}; use device, flow, mood or insight."),
        };

    // Insight logs are fetched from Homey, which may be out of reach.
    private static async Task<IReadOnlyList<HomeyInsightLog>> InsightLogsAsync(IHomey homeyActions, CancellationToken ct)
    {
        try
        {
            return await homeyActions.GetInsightLogsAsync(ct);
        }
        catch (Exception e) when (e is HomeyUnavailableException or HttpRequestException)
        {
            throw new McpException($"Homey cannot be reached: {e.Message}");
        }
    }

    private async Task<Dashboard> FindDashboardAsync(Guid id, CancellationToken ct) =>
        await db.Dashboards.FindAsync([id], ct) ?? throw new McpException($"Dashboard {id} not found.");

    private static void Refuse(string? error)
    {
        if (error is not null) throw new McpException(error);
    }
}
