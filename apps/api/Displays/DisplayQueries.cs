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

        var dashboard = display.DashboardId is { } dashboardId ? await db.Dashboards.FindAsync([dashboardId], ct) : null;
        var shown = dashboard is { Published: { } published }
            ? new ShownDashboard(dashboard.Id, dashboard.Name, dashboard.PublishedVersion, published)
            : null;
        return new ScreenView(display.ToSummary(), shown);
    }

    public static async Task<List<DisplayInfo>> ListAsync(HomeyDashDbContext db, DisplayPresence presence, CancellationToken ct)
    {
        var versions = await db.Dashboards.ToDictionaryAsync(d => d.Id, d => d.PublishedVersion, ct);
        return (await db.Displays.ToListAsync(ct))
            .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(d => Info(d, presence, d.DashboardId is { } id ? versions.GetValueOrDefault(id) : null))
            .ToList();
    }

    public static async Task<DisplayInfo> InfoAsync(HomeyDashDbContext db, DisplayPresence presence, Display display, CancellationToken ct)
    {
        var dashboard = display.DashboardId is { } id ? await db.Dashboards.FindAsync([id], ct) : null;
        return Info(display, presence, dashboard?.PublishedVersion);
    }

    private static DisplayInfo Info(Display display, DisplayPresence presence, int? latestVersion) =>
        new(display.Id, display.Name, display.DashboardId, new DisplayStatus(
            presence.IsConnected(display.ScreenId),
            display.ScreenId is not null,
            display.LastSeenAt,
            display.ShownVersion,
            latestVersion));
}
