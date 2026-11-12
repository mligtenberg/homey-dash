using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Displays;

public static class DisplayQueries
{
    // Which display a screen is and what it shows; null when the screen holds no display and belongs in setup.
    public static async Task<ScreenView?> ScreenViewAsync(HomeyDashDbContext db, Guid screenId, CancellationToken ct)
    {
        if (await db.Displays.SingleOrDefaultAsync(d => d.ScreenId == screenId, ct) is not { } display) return null;

        var ids = display.DashboardIds;
        var dashboards = await db.Dashboards.Where(d => ids.Contains(d.Id)).ToDictionaryAsync(d => d.Id, ct);
        var shown = ids
            .Select(id => dashboards.GetValueOrDefault(id))
            .OfType<Dashboard>()
            .Where(d => d.Published is not null)
            .Select(d => new ShownDashboard(d.Id, d.Name, d.PublishedVersion, d.Published!))
            .ToList();
        return new ScreenView(display.ToSummary(), shown);
    }

    public static async Task<List<DisplayInfo>> ListAsync(HomeyDashDbContext db, DisplayPresence presence, CancellationToken ct)
    {
        var versions = await LatestVersionsAsync(db, ct);
        return (await db.Displays.ToListAsync(ct))
            .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(d => Info(d, presence, versions))
            .ToList();
    }

    public static async Task<DisplayInfo> InfoAsync(HomeyDashDbContext db, DisplayPresence presence, Display display, CancellationToken ct) =>
        Info(display, presence, await LatestVersionsAsync(db, ct));

    // The screens of the displays that offer this dashboard.
    public static async Task<List<Guid?>> ScreensShowingAsync(HomeyDashDbContext db, Guid dashboardId, CancellationToken ct) =>
        await db.Displays
            .Where(d => d.Dashboards.Any(o => o.DashboardId == dashboardId))
            .Select(d => d.ScreenId)
            .ToListAsync(ct);

    private static Task<Dictionary<Guid, int>> LatestVersionsAsync(HomeyDashDbContext db, CancellationToken ct) =>
        db.Dashboards.ToDictionaryAsync(d => d.Id, d => d.PublishedVersion, ct);

    private static DisplayInfo Info(Display display, DisplayPresence presence, Dictionary<Guid, int> latest)
    {
        var summary = display.ToSummary();
        var shown = display.Dashboards.ToDictionary(o => o.DashboardId, o => o.ShownVersion);
        return new(summary.Id, summary.Name, summary.DashboardIds, summary.IdleRules, summary.LockWidgets, new DisplayStatus(
            presence.IsConnected(display.ScreenId),
            display.ScreenId is not null,
            display.LastSeenAt,
            display.DashboardIds.Select(id => new DashboardVersion(id, shown[id], latest.GetValueOrDefault(id))).ToList(),
            presence.IsKiosk(display.ScreenId),
            presence.Lux(display.ScreenId),
            presence.Details(display.ScreenId)), summary.LightSignal, summary.Language, summary.ZoneAccountId, summary.ZoneId, summary.TimerSound);
    }
}
