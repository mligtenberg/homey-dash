using System.Text.Json;
using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Photos;
using HomeyDash.Api.Plex;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Realtime;

/// <summary>
/// The realtime connection both apps keep open. Every connection receives Homey's changes (<c>DeviceChanged</c>,
/// <c>DeviceRemoved</c>, <c>Catalog</c>, <c>HomeyStatus</c>). A screen joins with its screen id and is told which
/// display it is with <c>Screen</c>; Management joins to receive <c>Displays</c> with every display's status and
/// <c>Dashboards</c> with the dashboard list. Every connection also receives <c>PhotoSets</c> whenever a photo set changes,
/// and <c>Plex</c> and <c>PlexSessions</c> as Plex's libraries and what plays change.
/// Mirrored in libs/api-client/src/lib/realtime.ts.
/// </summary>
public sealed class RealtimeHub(
    HomeyDashDbContext db,
    HomeyState homey,
    IHomey actions,
    DisplayPresence presence,
    RealtimeNotifier notifier,
    PhotoSync sync,
    PlexWatcher plexWatcher,
    IPlex plex,
    CurrentPlexAccount plexAccount,
    TimeProvider time) : Hub
{
    public const string Path = "/api/realtime";
    private const string ScreenKey = "screen";

    // Homey as it is now. Changes that follow arrive as messages.
    public HomeySnapshot Homey() =>
        new(homey.Status, homey.Devices.OrderBy(d => d.Name), homey.Flows.OrderBy(f => f.Name), homey.Moods.OrderBy(m => m.Name),
            homey.Zones.OrderBy(z => z.Name), homey.FlowFolders.OrderBy(f => f.Name), homey.Loaded);

    // Every photo set with its photos. Changes that follow arrive as PhotoSets.
    public Task<List<PhotoSetView>> PhotoSets() => PhotoEndpoints.ListAsync(db, sync, Context.ConnectionAborted);

    // Plex's libraries and what plays now. Changes that follow arrive as Plex and PlexSessions.
    public PlexSnapshot Plex() => plexWatcher.Snapshot;

    // Plays or pauses what plays on a player, or skips; the player must allow remote control.
    public async Task ControlPlex(string playerId, PlexCommand command)
    {
        if (plexAccount.Account?.Connection is not { } server) throw new HubException("Sign in with Plex under Accounts first.");
        var session = plexWatcher.Sessions.FirstOrDefault(s => s.PlayerId == playerId)
            ?? throw new HubException("That player isn't playing anything.");
        try
        {
            await plex.ControlAsync(server, playerId, command, session.Kind, Context.ConnectionAborted);
        }
        catch (PlexException e)
        {
            throw new HubException(e.Message);
        }
        plexWatcher.Wake();
    }

    // A screen joins with the id it keeps in localStorage. Null sends it to setup; later changes arrive as Screen.
    public async Task<ScreenView?> JoinScreen(Guid screenId)
    {
        if (Context.Items.TryGetValue(ScreenKey, out var joined) && !Equals(joined, screenId))
            throw new HubException("This connection already joined as another screen.");
        if (joined is null)
        {
            Context.Items[ScreenKey] = screenId;
            presence.Connect(screenId);
            await Groups.AddToGroupAsync(Context.ConnectionId, RealtimeNotifier.ScreenGroup(screenId));
            await SeenAsync(screenId, _ => { });
        }
        return await DisplayQueries.ScreenViewAsync(db, screenId, Context.ConnectionAborted);
    }

    // The screen reports the published version of each dashboard it now offers; none while it waits for one.
    public Task Showing(Dictionary<Guid, int> versions) =>
        Context.Items.TryGetValue(ScreenKey, out var screen) && screen is Guid screenId
            ? SeenAsync(screenId, display => display.Showing(versions))
            : throw new HubException("Join as a screen first.");

    public async Task<List<DisplayInfo>> JoinManagement()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, RealtimeNotifier.ManagementGroup);
        return await DisplayQueries.ListAsync(db, presence, Context.ConnectionAborted);
    }

    public Task SetCapability(string deviceId, string capabilityId, JsonElement value) =>
        Perform(ct => actions.SetCapabilityValueAsync(deviceId, capabilityId, value, ct));

    public Task TriggerFlow(string flowId) => Perform(ct => actions.TriggerFlowAsync(flowId, ct));

    public Task ActivateMood(string moodId) => Perform(ct => actions.ActivateMoodAsync(moodId, ct));

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.Items.TryGetValue(ScreenKey, out var screen) && screen is Guid screenId)
        {
            presence.Disconnect(screenId);
            await SeenAsync(screenId, _ => { });
        }
    }

    // Records that the display this screen holds was just seen, and tells Management.
    private async Task SeenAsync(Guid screenId, Action<Display> change)
    {
        if (await db.Displays.SingleOrDefaultAsync(d => d.ScreenId == screenId) is { } display)
        {
            change(display);
            display.LastSeenAt = time.GetUtcNow();
            await db.SaveChangesAsync();
        }
        await notifier.DisplaysChangedAsync(db, CancellationToken.None);
    }

    // Hub errors reach the client only as HubException; anything else arrives as a generic failure.
    private async Task Perform(Func<CancellationToken, Task> action)
    {
        try
        {
            await action(Context.ConnectionAborted);
        }
        catch (Exception e) when (e is HomeyNotFoundException or ArgumentException or HomeyUnavailableException or HttpRequestException)
        {
            throw new HubException(e.Message);
        }
    }
}

public sealed record HomeySnapshot(
    HomeyStatus Status, IEnumerable<HomeyDevice> Devices, IEnumerable<HomeyFlow> Flows, IEnumerable<HomeyMood> Moods,
    IEnumerable<HomeyZone> Zones, IEnumerable<HomeyFlowFolder> FlowFolders,
    // False until Homey's data first arrived, such as while no Homey account is set up; nothing is missing then.
    bool Loaded);

public sealed record HomeyCatalog(
    IEnumerable<HomeyFlow> Flows, IEnumerable<HomeyMood> Moods, IEnumerable<HomeyZone> Zones, IEnumerable<HomeyFlowFolder> FlowFolders);
