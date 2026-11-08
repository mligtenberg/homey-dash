using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using HomeyDash.Api.Photos;
using HomeyDash.Api.Weather;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.Realtime;

/// <summary>Tells screens and Management that displays, dashboards or photo sets changed.</summary>
public sealed class RealtimeNotifier(IHubContext<RealtimeHub> hub, DisplayPresence presence, TargetCatalog targets, PhotoSync sync,
    ImmichAccounts immich, DisplayDirectory directory, WeatherWatcher weather)
{
    public const string ManagementGroup = "management";

    public static string ScreenGroup(Guid screenId) => $"screen:{screenId}";

    // Sends each screen what it now is and shows (null: back to setup), then Management the new display list.
    public async Task ScreensChangedAsync(HomeyDashDbContext db, IEnumerable<Guid?> screenIds, CancellationToken ct)
    {
        foreach (var screenId in screenIds.OfType<Guid>().Distinct())
            await hub.Clients.Group(ScreenGroup(screenId))
                .SendAsync("Screen", await DisplayQueries.ScreenViewAsync(db, screenId, ct), ct);
        await DisplaysChangedAsync(db, ct);
    }

    // Rules on display signals follow, as a display is renamed, taken over or removed.
    public async Task DisplaysChangedAsync(HomeyDashDbContext db, CancellationToken ct)
    {
        await directory.RefreshAsync(db, ct);
        await hub.Clients.Group(ManagementGroup).SendAsync("Displays", await DisplayQueries.ListAsync(db, presence, ct), ct);
    }

    // Management's dashboard list: names, publish state, unpublished changes and tiles whose target is missing. A weather
    // tile may have been given a place, whose forecast then loads at once.
    public async Task DashboardsChangedAsync(HomeyDashDbContext db, CancellationToken ct)
    {
        weather.Wake();
        await hub.Clients.Group(ManagementGroup).SendAsync("Dashboards", await DashboardEndpoints.ListAsync(db, targets, ct), ct);
    }

    // Every photo set, to every connection: displays show their photos, Management also how syncing with Immich went.
    public async Task PhotoSetsChangedAsync(HomeyDashDbContext db, CancellationToken ct) =>
        await hub.Clients.All.SendAsync("PhotoSets", await PhotoEndpoints.ListAsync(db, sync, immich, ct), ct);
}
