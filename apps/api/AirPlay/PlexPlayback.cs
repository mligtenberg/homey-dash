using HomeyDash.AirPlay;
using HomeyDash.Api.Plex;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.AirPlay;

/// <summary>
/// Plays what a Plex account holds on an AirPlay receiver (ADR-0012): a movie, an episode, a track, or an album, which is
/// its tracks one after the other. The receiver plays one stream at a time, so the rest of an album waits in
/// <see cref="AirPlayNow"/> and the next track starts when the receiver finishes the one before. Failures are
/// <see cref="HubException"/>s, whose message is what a screen shows.
/// </summary>
public sealed class PlexPlayback : IDisposable
{
    private readonly PlexAccounts _accounts;
    private readonly PlexWatcher _watcher;
    private readonly IPlex _plex;
    private readonly PlexOptions _plexOptions;
    private readonly AirPlayOptions _options;
    private readonly IAirPlay _airPlay;
    private readonly AirPlayNow _nowPlaying;
    private readonly IHttpClientFactory _httpClients;
    private readonly ILogger<PlexPlayback> _log;

    public PlexPlayback(PlexAccounts accounts, PlexWatcher watcher, IPlex plex, PlexOptions plexOptions, AirPlayOptions options,
        IAirPlay airPlay, AirPlayNow nowPlaying, IHttpClientFactory httpClients, ILogger<PlexPlayback> log)
    {
        _accounts = accounts;
        _watcher = watcher;
        _plex = plex;
        _plexOptions = plexOptions;
        _options = options;
        _airPlay = airPlay;
        _nowPlaying = nowPlaying;
        _httpClients = httpClients;
        _log = log;
        _nowPlaying.Advance = AdvanceAsync;
    }

    /// <summary>
    /// Plays an item. An album plays from its first track, or from <paramref name="startTrackId"/> when it names one; either way
    /// the tracks after it follow.
    /// </summary>
    public async Task PlayAsync(int accountId, string itemId, string deviceId, string? startTrackId, PlexStreamChoice? choice, CancellationToken ct)
    {
        if (!_options.Enabled) throw new HubException("AirPlay isn't set up.");
        if (_accounts.Find(accountId)?.Connection is not { } server) throw new HubException("Sign in with Plex under Accounts first.");
        // Anything the server has: what the library lists as new, or what a search found.
        var item = _watcher.Snapshot.Accounts.FirstOrDefault(a => a.AccountId == accountId)?.Libraries
            .SelectMany(l => l.Recent).FirstOrDefault(i => i.Id == itemId);
        try
        {
            item ??= await _plex.ItemAsync(server, itemId, ct);
            if (item is null) throw new HubException("Plex no longer has that.");
            switch (item.Kind)
            {
                case "movie" or "episode" or "track":
                    await StartAsync(accountId, server, item, deviceId, choice, item.Kind == "track" ? item.Subtitle : null, ct);
                    // Starting this over with another track (choice) goes on with the album it is part of.
                    if (choice is null) _nowPlaying.SetQueue(deviceId, null);
                    break;
                case "album":
                    var tracks = (await _plex.ChildrenAsync(server, item.Id, ct)).Where(t => t.Kind == "track").ToList();
                    if (tracks.Count == 0) throw new HubException("That album has no tracks.");
                    var first = startTrackId is null ? 0 : tracks.FindIndex(t => t.Id == startTrackId);
                    if (first < 0) throw new HubException("That track isn't on the album.");
                    var queue = new AirPlayQueue(item, tracks, first);
                    await StartAsync(accountId, server, tracks[first], deviceId, null, queue.Detail, ct);
                    _nowPlaying.SetQueue(deviceId, queue);
                    break;
                default:
                    throw new HubException("Only a movie, an episode, an album or a track plays on AirPlay.");
            }
        }
        catch (PlexException e)
        {
            throw new HubException(e.Message);
        }
        catch (AirPlayException e)
        {
            throw new HubException(e.Message);
        }
    }

    private async Task StartAsync(int accountId, PlexConnection server, PlexItem item, string deviceId, PlexStreamChoice? choice, string? detail,
        CancellationToken ct)
    {
        string Build(PlexConnection from, string? session, bool copyVideo) => item.Kind == "track"
            ? PlexStream.AudioUrl(from, item.Id, session)
            : PlexStream.Url(from, item.Id, session, copyVideo, choice);
        var url = Build(server, null, true);
        if (!_plexOptions.Fake)
        {
            // A receiver that cannot play what it is given starts and stops at once, saying nothing; the server's
            // answer says why, so find out first.
            var http = _httpClients.CreateClient(PlexClient.HttpClientName);
            var (receiver, source, copyVideo) = await PlexStream.PrepareAsync(http, server, item.Id, ct);
            var session = Guid.NewGuid().ToString("N");
            var check = await PlexStreamCheck.RunAsync(http, receiver, Build(receiver, session, copyVideo), session, source,
                copyVideo && choice?.SubtitleStreamId is null, ct);
            if (!check.Ok) throw new HubException(check.Summary);
            url = Build(receiver, null, copyVideo);
        }
        await _airPlay.PlayAsync(deviceId, url, ct);
        var name = (await _airPlay.PairedAsync(ct)).FirstOrDefault(d => d.Id == deviceId)?.Name ?? deviceId;
        await _nowPlaying.StartedAsync(new AirPlayPlayback(deviceId, name, accountId, item.Id, item.Title, false,
            choice?.AudioStreamId, choice?.SubtitleStreamId, (choice?.OffsetSeconds ?? 0) * 1000L, default)
        {
            Detail = detail,
            DurationMs = item.DurationMs ?? 0,
        });
    }

    // The receiver finished a track: the next one of the album starts, or nothing does and the album is over.
    private async Task<bool> AdvanceAsync(string deviceId)
    {
        if (_nowPlaying.Find(deviceId) is not { } playing || _nowPlaying.Queue(deviceId) is not { } queue || queue.Position + 1 >= queue.Tracks.Count)
            return false;
        if (_accounts.Find(playing.AccountId)?.Connection is not { } server) return false;
        var next = queue with { Position = queue.Position + 1 };
        try
        {
            await StartAsync(playing.AccountId, server, next.Tracks[next.Position], deviceId, null, next.Detail, CancellationToken.None);
            _nowPlaying.SetQueue(deviceId, next);
            return true;
        }
        catch (Exception e) when (e is HubException or PlexException or AirPlayException)
        {
            _log.LogWarning(e, "Could not go on to the next track of {Album} on {Device}", queue.Album.Title, deviceId);
            return false;
        }
    }

    public void Dispose() => _nowPlaying.Advance = null;
}
