using HomeyDash.AirPlay;
using System.Text.Json;
using HomeyDash.Api.AirPlay;
using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Photos;
using HomeyDash.Api.Plex;
using HomeyDash.Api.Rules;
using HomeyDash.Api.Weather;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Realtime;

/// <summary>
/// The realtime connection both apps keep open. Every connection receives each Homey's changes, which name its account
/// (<c>DeviceChanged</c>, <c>DeviceRemoved</c>, <c>Catalog</c>, <c>HomeyStatus</c>), and <c>Homeys</c> with every Homey
/// again when a Homey account is added, removed or renamed. A screen joins with its screen id and is told which
/// display it is with <c>Screen</c>; Management joins to receive <c>Displays</c> with every display's status and
/// <c>Dashboards</c> with the dashboard list. Every connection also receives <c>PhotoSets</c> whenever a photo set changes,
/// <c>Plex</c> and <c>PlexSessions</c> as Plex's libraries and what plays change, and <c>Forecasts</c> as the weather where
/// each Homey is changes. A connection can subscribe to rules
/// (ADR-0010), whose changed answers arrive as <c>RuleAnswers</c>.
/// Mirrored in libs/api-client/src/lib/realtime.ts.
/// </summary>
public sealed class RealtimeHub(
    HomeyDashDbContext db,
    Homeys homeys,
    DisplayPresence presence,
    RealtimeNotifier notifier,
    PhotoSync sync,
    ImmichAccounts immich,
    PlexWatcher plexWatcher,
    IPlex plex,
    PlexAccounts plexAccounts,
    PlexTimeline plexTimeline,
    PlexSignIn plexSignIn,
    IAirPlay airPlay,
    AirPlayNow nowPlaying,
    PlexPlayback playback,
    AirPlayOptions airPlayOptions,
    RuleEngine rules,
    RuleSubscriptions subscriptions,
    DisplayDirectory directory,
    DisplayTouches touches,
    DisplayBrightness brightness,
    AppCatalog appCatalog,
    WeatherWatcher weather,
    TimeProvider time) : Hub
{
    public const string Path = "/api/realtime";
    private const string ScreenKey = "screen";

    // Every Homey as it is now, oldest account first. Changes that follow arrive as messages.
    public IEnumerable<HomeySnapshot> Homey() => HomeySnapshot.All(homeys);

    // Every photo set with its photos. Changes that follow arrive as PhotoSets.
    public Task<List<PhotoSetView>> PhotoSets() => PhotoEndpoints.ListAsync(db, sync, immich, Context.ConnectionAborted);

    // Every Plex account's libraries, and what plays now. Changes that follow arrive as Plex and PlexSessions.
    public PlexSnapshot Plex() => plexWatcher.Snapshot;

    // The weather where each Homey is, oldest account first (ADR-0013). Changes that follow arrive as Forecasts.
    public IReadOnlyList<Forecast> Forecasts() => weather.All;

    // Items of the account's Plex libraries (one, or every one when libraryId is null) whose title matches, not only the newest:
    // movies, shows and albums, and episodes and tracks by their own title.
    public async Task<IReadOnlyList<PlexItem>> SearchPlex(int accountId, string query, string? libraryId)
    {
        if (plexAccounts.Find(accountId)?.Connection is not { } server) throw new HubException("Sign in with Plex under Accounts first.");
        query = query.Trim();
        if (query.Length < 2) return [];
        try
        {
            return await plex.SearchAsync(server, query, libraryId, 12, Context.ConnectionAborted);
        }
        catch (PlexException e)
        {
            throw new HubException(e.Message);
        }
    }

    // A page of what one of the account's libraries holds, alphabetically: films, series or albums. Total is how many there are.
    public async Task<PlexPage> PlexLibraryItems(int accountId, string libraryId, int start, int size)
    {
        if (plexAccounts.Find(accountId)?.Connection is not { } server) throw new HubException("Sign in with Plex under Accounts first.");
        try
        {
            // The watcher has the libraries once it has looked; right after a profile was chosen it is still looking, so ask the server.
            var library = plexWatcher.Snapshot.Accounts.FirstOrDefault(a => a.AccountId == accountId)?.Libraries.FirstOrDefault(l => l.Id == libraryId)
                ?? (await plex.LibrariesAsync(server, 0, Context.ConnectionAborted)).FirstOrDefault(l => l.Id == libraryId)
                ?? throw new HubException("Plex no longer has that library.");
            return await plex.LibraryItemsAsync(server, library.Id, library.Type, Math.Max(0, start), Math.Clamp(size, 1, 100), Context.ConnectionAborted);
        }
        catch (PlexException e)
        {
            throw new HubException(e.Message);
        }
    }

    // What is under an item, in order: a show's seasons, a season's episodes, an album's tracks.
    public async Task<IReadOnlyList<PlexItem>> PlexChildren(int accountId, string itemId)
    {
        if (plexAccounts.Find(accountId)?.Connection is not { } server) throw new HubException("Sign in with Plex under Accounts first.");
        try
        {
            return await plex.ChildrenAsync(server, itemId, Context.ConnectionAborted);
        }
        catch (PlexException e)
        {
            throw new HubException(e.Message);
        }
    }

    // Plays or pauses what plays on one of the account's players, or skips; the player must allow remote control.
    public async Task ControlPlex(int accountId, string playerId, PlexCommand command)
    {
        if (plexAccounts.Find(accountId)?.Connection is not { } server) throw new HubException("Sign in with Plex under Accounts first.");
        var session = plexWatcher.Sessions.FirstOrDefault(s => s.AccountId == accountId && s.PlayerId == playerId)
            ?? throw new HubException("That player isn't playing anything.");
        try
        {
            await plex.ControlAsync(server, playerId, command, session.Kind, Context.ConnectionAborted);
        }
        catch (PlexException e)
        {
            throw new HubException(e.Message);
        }
        plexWatcher.Wake(accountId);
    }

    // The paired AirPlay receivers, or that AirPlay isn't set up (ADR-0012).
    public async Task<AirPlayInfo> AirPlayDevices()
    {
        if (!airPlayOptions.Enabled) return new AirPlayInfo(false, []);
        try
        {
            return new AirPlayInfo(true, await airPlay.PairedAsync(Context.ConnectionAborted));
        }
        catch (AirPlayException e)
        {
            throw new HubException(e.Message);
        }
    }

    // Plays a movie, an episode, a track or an album of a Plex account on an AirPlay receiver, which fetches the stream from the
    // Plex server itself. An album plays from its first track, track after track.
    public Task PlayOnAirPlay(int accountId, string itemId, string deviceId) =>
        playback.PlayAsync(accountId, itemId, deviceId, null, null, Context.ConnectionAborted);

    // Plays an album from one of its tracks, or a season from one of its episodes (the first when trackId is null); the ones after it follow.
    public Task PlayAlbumOnAirPlay(int accountId, string albumId, string? trackId, string deviceId) =>
        playback.PlayAsync(accountId, albumId, deviceId, trackId, null, Context.ConnectionAborted);

    // What plays on AirPlay now, on every receiver. Changes that follow arrive as AirPlayNow.
    public IReadOnlyList<AirPlayPlayback> AirPlayNowPlaying() => nowPlaying.All;

    // Changes the audio or subtitle track of what plays on a receiver (no subtitleStreamId: none). The stream is one the server
    // makes, so it starts over from where it is by HomeyDash's count.
    public Task ChangeAirPlayTracks(string deviceId, string? audioStreamId, string? subtitleStreamId)
    {
        var playing = nowPlaying.Find(deviceId) ?? throw new HubException("Nothing is playing on that Apple TV.");
        return playback.PlayAsync(playing.AccountId, playing.ItemId, deviceId, null,
            new PlexStreamChoice(audioStreamId, subtitleStreamId, nowPlaying.PositionSeconds(playing)), Context.ConnectionAborted);
    }

    // The profiles of the Plex Home the account belongs to, to use as; none when it has no home.
    public async Task<PlexProfileList> PlexProfiles(int accountId)
    {
        if (plexAccounts.Find(accountId) is not { } account) throw new HubException("Sign in with Plex under Accounts first.");
        try
        {
            var (profiles, current) = await plexSignIn.ProfilesAsync(account, Context.ConnectionAborted);
            return new PlexProfileList(profiles, current);
        }
        catch (PlexException e)
        {
            throw new HubException(e.Message);
        }
    }

    // Uses the account as one of its profiles, for every screen: what is watched and seen is that profile's. A profile with a PIN needs it.
    public async Task PlexSelectProfile(int accountId, string profileId, string? pin)
    {
        if (plexAccounts.Find(accountId) is not { } account) throw new HubException("Sign in with Plex under Accounts first.");
        try
        {
            await plexSignIn.UseProfileAsync(account, profileId, pin, Context.ConnectionAborted);
        }
        catch (PlexException e)
        {
            throw new HubException(e.Message);
        }
    }

    // Where this screen's own player is in a film, episode or track: playing, paused or stopped, so Plex keeps what was watched.
    public async Task PlexProgress(int accountId, string itemId, string state, long timeMs, long durationMs)
    {
        if (state is not ("playing" or "paused" or "stopped") || itemId.Length is 0 or > 12 || !itemId.All(char.IsAsciiDigit))
            throw new HubException("That is not a progress Plex knows.");
        await plexTimeline.ReportAsync(accountId, itemId, state, timeMs, durationMs, Context.ConnectionAborted);
    }

    // The audio and subtitle tracks of a movie or episode, to choose between.
    public async Task<PlexTracks> PlexTracks(int accountId, string itemId)
    {
        if (plexAccounts.Find(accountId)?.Connection is not { } server) throw new HubException("Sign in with Plex under Accounts first.");
        try
        {
            return await plex.TracksAsync(server, itemId, Context.ConnectionAborted);
        }
        catch (PlexException e)
        {
            throw new HubException(e.Message);
        }
    }

    // Pauses or resumes what plays on an AirPlay receiver.
    public async Task SetAirPlayPaused(string deviceId, bool paused)
    {
        try
        {
            await airPlay.SetPausedAsync(deviceId, paused, Context.ConnectionAborted);
            await nowPlaying.PausedAsync(deviceId, paused);
        }
        catch (AirPlayException e)
        {
            throw new HubException(e.Message);
        }
    }

    public async Task StopAirPlay(string deviceId)
    {
        try
        {
            await airPlay.StopAsync(deviceId, Context.ConnectionAborted);
            await nowPlaying.StoppedAsync(deviceId);
        }
        catch (AirPlayException e)
        {
            throw new HubException(e.Message);
        }
    }

    // Identifies the running build; it changes when an update is installed, so a screen that sees it change reloads.
    public string Build() => BuildId;

    private static readonly string BuildId = typeof(RealtimeHub).Assembly.ManifestModule.ModuleVersionId.ToString();

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

    // Each acts on the Homey of the tile's account; null for the oldest.
    public Task SetCapability(int? accountId, string deviceId, string capabilityId, JsonElement value) =>
        Perform(ct => homeys.Require(accountId).SetCapabilityValueAsync(deviceId, capabilityId, value, ct));

    public Task TriggerFlow(int? accountId, string flowId) => Perform(ct => homeys.Require(accountId).TriggerFlowAsync(flowId, ct));

    public Task ActivateMood(int? accountId, string moodId) => Perform(ct => homeys.Require(accountId).ActivateMoodAsync(moodId, ct));

    public Task JoinSpeakerGroup(int? accountId, string deviceId, string withDeviceId) =>
        Perform(ct => homeys.Require(accountId).JoinSpeakerGroupAsync(deviceId, withDeviceId, ct));

    public Task LeaveSpeakerGroup(int? accountId, string deviceId) =>
        Perform(ct => homeys.Require(accountId).LeaveSpeakerGroupAsync(deviceId, ct));

    public Task SetGroupVolume(int? accountId, string deviceId, int volume) =>
        Perform(ct => homeys.Require(accountId).SetGroupVolumeAsync(deviceId, volume, ct));

    public async Task<IReadOnlyList<SpeakerMusic>> SpeakerMusic(int? accountId, string deviceId, string kind)
    {
        IReadOnlyList<SpeakerMusic> music = [];
        await Perform(async ct => music = await homeys.Require(accountId).ListSpeakerMusicAsync(deviceId, kind, ct));
        return music;
    }

    public Task PlaySpeakerMusic(int? accountId, string deviceId, string kind, JsonElement item) =>
        Perform(ct => homeys.Require(accountId).PlaySpeakerMusicAsync(deviceId, kind, item, ct));

    public async Task<IReadOnlyList<DeviceApp>> DeviceApps(int? accountId, string deviceId)
    {
        IReadOnlyList<DeviceApp> apps = [];
        await Perform(async ct => apps = await appCatalog.DescribeAsync(await homeys.Require(accountId).ListDeviceAppsAsync(deviceId, ct), ct));
        return apps;
    }

    public Task OpenDeviceApp(int? accountId, string deviceId, JsonElement item) =>
        Perform(ct => homeys.Require(accountId).OpenDeviceAppAsync(deviceId, item, ct));

    /// <summary>
    /// Subscribes to a rule under an id the connection chooses, answering whether it holds now. A screen's rules are
    /// evaluated for the display it holds; Management's as if on <paramref name="asDisplay"/>, or on none.
    /// </summary>
    public RuleAnswer SubscribeRule(string id, JsonElement rule, Guid? asDisplay)
    {
        var (parsed, error) = RuleSetup.Check(rule, rules);
        if (parsed is null) throw new HubException(error);
        var context = Context.Items.TryGetValue(ScreenKey, out var screen) && screen is Guid screenId
            ? new RuleContext(ScreenId: screenId)
            : new RuleContext(DisplayId: asDisplay);
        return subscriptions.Subscribe(Context.ConnectionId, id, parsed, context);
    }

    public void UnsubscribeRule(string id) => subscriptions.Unsubscribe(Context.ConnectionId, id);

    // The screen was touched; screens report this at most every few seconds.
    public void Touched()
    {
        if (!Context.Items.TryGetValue(ScreenKey, out var screen) || screen is not Guid screenId) throw new HubException("Join as a screen first.");
        if (directory.ByScreen(screenId) is { } display) touches.Touch(display.Id, time.GetUtcNow());
    }

    // How much light falls on the screen in lux, from its light sensor or estimated with its camera; screens measure
    // every minute or so.
    public async Task Brightness(double lux)
    {
        if (!Context.Items.TryGetValue(ScreenKey, out var screen) || screen is not Guid screenId) throw new HubException("Join as a screen first.");
        if (!double.IsFinite(lux)) return;
        if (directory.ByScreen(screenId) is { } display) brightness.Measure(display.Id, lux);
        presence.ReportLux(screenId, Math.Round(Math.Clamp(lux, 0, DisplayBrightness.MaxLux)));
        await notifier.DisplaysChangedAsync(db, CancellationToken.None);
    }

    // The screen runs in Fully Kiosk Browser; screens that don't never say.
    public async Task Kiosk()
    {
        if (!Context.Items.TryGetValue(ScreenKey, out var screen) || screen is not Guid screenId) throw new HubException("Join as a screen first.");
        presence.ReportKiosk(screenId);
        await notifier.DisplaysChangedAsync(db, CancellationToken.None);
    }

    // What the screen and its browser are, such as its size and whether Fully Kiosk Browser's interface is there;
    // screens say when they connect and when something changes.
    public async Task Details(ScreenDetails details)
    {
        if (!Context.Items.TryGetValue(ScreenKey, out var screen) || screen is not Guid screenId) throw new HubException("Join as a screen first.");
        presence.ReportDetails(screenId, details);
        if (details.Fully is not null) presence.ReportKiosk(screenId);
        await notifier.DisplaysChangedAsync(db, CancellationToken.None);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        subscriptions.Drop(Context.ConnectionId);
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
    int AccountId, string AccountName,
    HomeyStatus Status, IEnumerable<HomeyDevice> Devices, IEnumerable<HomeyFlow> Flows, IEnumerable<HomeyMood> Moods,
    IEnumerable<HomeyZone> Zones, IEnumerable<HomeyFlowFolder> FlowFolders,
    // False until the Homey's data first arrived; nothing is missing then.
    bool Loaded,
    // Null until Homey first told it, or when Homey won't.
    HomeyWeather? Weather)
{
    public static List<HomeySnapshot> All(Homeys homeys) =>
        homeys.All.Select(e => new HomeySnapshot(e.AccountId, e.Name, e.State.Status, e.State.Devices.OrderBy(d => d.Name),
            e.State.Flows.OrderBy(f => f.Name), e.State.Moods.OrderBy(m => m.Name), e.State.Zones.OrderBy(z => z.Name),
            e.State.FlowFolders.OrderBy(f => f.Name), e.State.Loaded, e.State.Weather)).ToList();
}

public sealed record HomeyCatalog(
    int AccountId, IEnumerable<HomeyFlow> Flows, IEnumerable<HomeyMood> Moods, IEnumerable<HomeyZone> Zones,
    IEnumerable<HomeyFlowFolder> FlowFolders);

// A device of the account's Homey changed or was added.
public sealed record HomeyDeviceChange(int AccountId, HomeyDevice Device);

// The weather of the account's Homey changed.
public sealed record HomeyWeatherChange(int AccountId, HomeyWeather Weather);

public sealed record HomeyDeviceRemoval(int AccountId, string DeviceId);
