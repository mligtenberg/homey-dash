using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Photos;
using HomeyDash.Api.Plex;
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
public sealed class ManagementTools(
    HomeyDashDbContext db, Homeys homeys, PlexWatcher plex, TargetCatalog targets, RealtimeNotifier notifier, DisplayPresence presence, TimeProvider time)
{
    public const string Path = "/mcp";

    // Arguments and results read and write dashboards as the API does. The SDK needs a resolver set explicitly.
    public static JsonSerializerOptions Json { get; } = new(Dashboard.Json) { TypeInfoResolver = new DefaultJsonTypeInfoResolver() };

    // Mirrors CORE_TILES in libs/tiles/src/lib/core/core-tiles.ts and PLEX_TILES in libs/tiles/src/lib/plex/plex-tiles.ts; the API itself never looks inside settings (ADR-0003).
    private const string TileKinds = """
        Tile kinds, with the sizes each supports and the target type its settings.target takes:
        - "device" (small, wide, large): a device; optional settings.capability picks the capability shown (absent: automatic).
        - "flow" (small, wide): a flow, started when pressed.
        - "mood" (small, wide): a mood, activated when pressed.
        - "mood-list" (wide, full, large, full-large): several moods, a button each; settings.targets lists their ids in order
          and settings.target is null. A page shows 4 moods on wide, 6 on full, 10 on large and 15 on full-large; more go on pages people swipe to, so put the most used first.
        - "statistic" (large, full-large): an insight log, charted; optional settings.window is lastHour, last24Hours (default), last7Days or last31Days.
        - "photo" (small, wide, full, large, full-large): a photo set, its photos shown one at a time in shuffled order; settings.target
          is the photo set's target ("photo-set:<id>"); optional settings.interval is the seconds between photos (default 30).
        - "plex-now-playing" (small, wide, full, large, full-large): what plays on a Plex player, with play/pause and skip buttons;
          settings.target is "plex-player:any" for whatever plays, or a player's target.
        - "plex-recent" (small, wide, full, large, full-large): the posters of what was newly added to Plex; settings.target is
          "plex-library:all" or a library's target.
        Every tile's settings may have a "label" that overrides its target's name. A home can have several Homey and Plex
        accounts: a Homey or Plex tile's settings.account is the account of its target (list_targets gives it); left out, the
        oldest account. A mood-list tile's moods are all in its one account.
        """;

    [McpServerTool(Name = "list_dashboards", ReadOnly = true)]
    [Description("Lists all dashboards with their publish state, whether the draft has unpublished changes, and how many tiles point at something Homey does not know.")]
    public Task<List<DashboardSummary>> ListDashboards(CancellationToken ct) => DashboardEndpoints.ListAsync(db, targets, ct);

    [McpServerTool(Name = "get_dashboard", ReadOnly = true)]
    [Description("Gets a dashboard with its draft and published layouts.")]
    public async Task<DashboardDetail> GetDashboard(Guid dashboardId, CancellationToken ct) =>
        (await FindDashboardAsync(dashboardId, ct)).ToDetail(targets);

    [McpServerTool(Name = "create_dashboard")]
    [Description("Creates a dashboard with an empty draft of 4 rows. Fill it with save_draft and make it showable with publish_dashboard.")]
    public async Task<DashboardDetail> CreateDashboard([Description("At most 100 characters.")] string name, CancellationToken ct)
    {
        Refuse(DashboardValidator.ValidateName(name));
        var dashboard = new Dashboard { Name = name.Trim() };
        db.Dashboards.Add(dashboard);
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        return dashboard.ToDetail(targets);
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
        return dashboard.ToDetail(targets);
    }

    [McpServerTool(Name = "save_draft", Idempotent = true)]
    [Description($"""
        Replaces a dashboard's draft. Displays never show a draft; publish it to show it.
        A dashboard has 1 to 12 rows. Each section is a grid 3 columns wide and as many rows tall as the dashboard;
        sections sit side by side and scroll horizontally. A tile's position is the zero-based column and row of its
        top-left cell. Sizes in cells (columns×rows): small 1×1, wide 2×1, full 3×1, large 2×2, full-large 3×2.
        Tiles must stay inside their section's grid and never overlap. Section and tile ids are any unique strings.
        Find targets with list_targets.
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
        return dashboard.ToDetail(targets);
    }

    [McpServerTool(Name = "publish_dashboard")]
    [Description("Makes a dashboard's draft its published version. Every display showing it switches to the new version at once.")]
    public async Task<DashboardDetail> PublishDashboard(Guid dashboardId, CancellationToken ct)
    {
        var dashboard = await FindDashboardAsync(dashboardId, ct);
        dashboard.Publish(time.GetUtcNow());
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        await notifier.ScreensChangedAsync(db, await DisplayQueries.ScreensShowingAsync(db, dashboardId, ct), ct);
        return dashboard.ToDetail(targets);
    }

    [McpServerTool(Name = "list_displays", ReadOnly = true)]
    [Description("Lists the displays (the screens in the home that completed setup), each with its main dashboard, the other dashboards it can switch to, and whether it is connected and shows the latest published version of each.")]
    public Task<List<DisplayInfo>> ListDisplays(CancellationToken ct) => DisplayQueries.ListAsync(db, presence, ct);

    [McpServerTool(Name = "assign_dashboard", Idempotent = true)]
    [Description("""
        Assigns a display its main dashboard, which it shows at once and returns to when left alone, and the other
        dashboards people can switch to from a tape along the left of the screen, in that order. Every dashboard must
        be published. Without a dashboard id the display waits for one and has no others.
        """)]
    public async Task<DisplayInfo> AssignDashboard(
        Guid displayId, Guid? dashboardId = null, Guid[]? otherDashboardIds = null, CancellationToken ct = default)
    {
        if (await db.Displays.FindAsync([displayId], ct) is not { } display)
            throw new McpException($"Display {displayId} not found.");
        Refuse(await DisplayEndpoints.AssignAsync(db, display, dashboardId, otherDashboardIds ?? [], ct));
        await db.SaveChangesAsync(ct);
        await notifier.ScreensChangedAsync(db, [display.ScreenId], ct);
        return await DisplayQueries.InfoAsync(db, presence, display, ct);
    }

    // Account: the account a tile on it names in settings.account, for kinds that can have several.
    public sealed record Target(string Id, string Name, string? Detail, int? Account = null);

    [McpServerTool(Name = "list_targets", ReadOnly = true)]
    [Description("""
        Lists what tiles can point at: their ids go in a tile's settings.target. Devices, flows, moods and insight logs are in
        Homey; a device's detail lists its capability ids, for a device tile's settings.capability. Photo sets follow an Immich
        album and are made in Management, so assistants can only use the ones that exist.
        """)]
    public async Task<IEnumerable<Target>> ListTargets(
        [Description("device, flow, mood, insight, photoSet, plexPlayer or plexLibrary")] string type, CancellationToken ct) =>
        type switch
        {
            "device" => homeys.All.SelectMany(h => h.State.Devices.OrderBy(d => d.Name).Select(d =>
                new Target(d.Id, d.Name, $"{d.Class} in {d.ZoneName ?? "no zone"} on {h.Name}; capabilities: {string.Join(", ", d.Capabilities.Keys)}", h.AccountId))),
            "flow" => homeys.All.SelectMany(h => h.State.Flows.OrderBy(f => f.Name).Select(f =>
                new Target(f.Id, f.Name, f.Enabled ? $"on {h.Name}" : $"on {h.Name}, turned off", h.AccountId))),
            "mood" => homeys.All.SelectMany(h => h.State.Moods.OrderBy(m => m.Name).Select(m => new Target(m.Id, m.Name, $"on {h.Name}", h.AccountId))),
            "insight" => await InsightLogsAsync(ct),
            "photoSet" => (await db.PhotoSets.AsNoTracking().ToListAsync(ct)).OrderBy(p => p.Name).Select(p =>
                new Target(p.Target, p.Name, (p.Photos.Count == 1 ? "1 photo" : $"{p.Photos.Count} photos") + (p.Selection is null ? $" from the Immich album {p.AlbumName}" : " drawn at random from Immich"))),
            "plexPlayer" => plex.Overviews.SelectMany(o => (IEnumerable<Target>)[
                new Target(TargetCatalog.AnyPlexPlayer, "Any player", $"whatever plays on {o.AccountName}", o.AccountId),
                .. o.Players.Select(p => new Target(TargetCatalog.PlexPlayerPrefix + p.Id, p.Name, $"on {o.AccountName}, played since HomeyDash started", o.AccountId))]),
            "plexLibrary" => plex.Overviews.SelectMany(o => (IEnumerable<Target>)[
                new Target(TargetCatalog.AllPlexLibraries, "All libraries", $"on {o.AccountName}", o.AccountId),
                .. o.Libraries.Select(l => new Target(TargetCatalog.PlexLibraryPrefix + l.Id, l.Title, $"{l.Type} on {o.AccountName}", o.AccountId))]),
            _ => throw new McpException($"Unknown target type {type}; use device, flow, mood, insight, photoSet, plexPlayer or plexLibrary."),
        };

    // Insight logs are fetched from each Homey, which may be out of reach.
    private async Task<List<Target>> InsightLogsAsync(CancellationToken ct)
    {
        List<Target> logs = [];
        foreach (var h in homeys.All)
        {
            try
            {
                logs.AddRange((await h.Homey.GetInsightLogsAsync(ct)).Select(l => new Target(l.Id,
                    string.Join(" · ", new[] { l.OwnerName, l.Title }.OfType<string>()), $"{l.Units ?? "no units"} on {h.Name}", h.AccountId)));
            }
            catch (Exception e) when (e is HomeyUnavailableException or HttpRequestException)
            {
                throw new McpException($"Homey {h.Name} cannot be reached: {e.Message}");
            }
        }
        return logs;
    }

    private async Task<Dashboard> FindDashboardAsync(Guid id, CancellationToken ct) =>
        await db.Dashboards.FindAsync([id], ct) ?? throw new McpException($"Dashboard {id} not found.");

    private static void Refuse(string? error)
    {
        if (error is not null) throw new McpException(error);
    }
}
