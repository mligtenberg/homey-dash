using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.Realtime;

/// <summary>Tells screens and Management that displays or dashboards changed.</summary>
public sealed class RealtimeNotifier(IHubContext<RealtimeHub> hub, DisplayPresence presence)
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

    public async Task DisplaysChangedAsync(HomeyDashDbContext db, CancellationToken ct) =>
        await hub.Clients.Group(ManagementGroup).SendAsync("Displays", await DisplayQueries.ListAsync(db, presence, ct), ct);

    // Management's dashboard list: names, publish state and unpublished changes.
    public async Task DashboardsChangedAsync(HomeyDashDbContext db, CancellationToken ct) =>
        await hub.Clients.Group(ManagementGroup).SendAsync("Dashboards", await DashboardEndpoints.ListAsync(db, ct), ct);
}
