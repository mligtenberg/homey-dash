using System.Collections.Concurrent;
using HomeyDash.Api.Plex;
using HomeyDash.Api.Realtime;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.AirPlay;

/// <summary>
/// What plays on an AirPlay receiver because a screen started it. OffsetMs is where it was at At; while it is not Paused
/// it moves on from there (the receiver doesn't report its position, so this is HomeyDash's own count). The tracks are
/// the choice made, null being Plex's default audio and no subtitle.
/// </summary>
public sealed record AirPlayPlayback(
    string DeviceId, string DeviceName, int AccountId, string ItemId, string Title, bool Paused,
    string? AudioStreamId, string? SubtitleStreamId, long OffsetMs, DateTimeOffset At)
{
    // What the title is part of, such as the artist, the album and which track of it this is.
    public string? Detail { get; init; }
    // How long it runs; 0 when the server doesn't say.
    public long DurationMs { get; init; }
}

/// <summary>An album playing track by track: Position is the index in Tracks of the track that plays now.</summary>
public sealed record AirPlayQueue(PlexItem Album, IReadOnlyList<PlexItem> Tracks, int Position)
{
    public string Detail => string.Join(" · ",
        string.Join(" — ", new[] { Album.Subtitle, Album.Title }.OfType<string>()), $"{Position + 1} of {Tracks.Count}");
}

/// <summary>
/// The playback every screen shows controls for: one place that knows what plays where, pushed to every connection as
/// <c>AirPlayNow</c> whenever it changes, so a screen that did not start it can pause or stop it too.
/// </summary>
public sealed class AirPlayNow : IDisposable
{
    // A track that ends this close to its length ended because it finished, not because someone stopped it on the TV.
    private static readonly TimeSpan FinishedWithin = TimeSpan.FromSeconds(15);

    private readonly ConcurrentDictionary<string, AirPlayPlayback> _playing = new();
    private readonly ConcurrentDictionary<string, AirPlayQueue> _queues = new();
    private readonly IHubContext<RealtimeHub> _hub;
    private readonly IAirPlay _airPlay;
    private readonly PlexTimeline _timeline;
    private readonly TimeProvider _time;
    private readonly ILogger<AirPlayNow> _log;

    public AirPlayNow(IHubContext<RealtimeHub> hub, IAirPlay airPlay, PlexTimeline timeline, TimeProvider time, ILogger<AirPlayNow> log)
    {
        _timeline = timeline;
        _hub = hub;
        _airPlay = airPlay;
        _time = time;
        _log = log;
        // The Apple TV stopping or finishing, or someone stopping it with its remote, ends it for every screen.
        _airPlay.Ended += OnEnded;
    }

    public IReadOnlyList<AirPlayPlayback> All => _playing.Values.OrderBy(p => p.DeviceName, StringComparer.OrdinalIgnoreCase).ToList();

    public AirPlayPlayback? Find(string deviceId) => _playing.GetValueOrDefault(deviceId);

    public AirPlayQueue? Queue(string deviceId) => _queues.GetValueOrDefault(deviceId);

    public void SetQueue(string deviceId, AirPlayQueue? queue)
    {
        if (queue is null) _queues.TryRemove(deviceId, out _);
        else _queues[deviceId] = queue;
    }

    // Goes on with what follows when a receiver finished what it played; says whether it did. Set by whoever can start things.
    public Func<string, Task<bool>>? Advance { get; set; }

    // Where it is now, in whole seconds from the start.
    public int PositionSeconds(AirPlayPlayback playback) =>
        (int)(Math.Max(0, playback.OffsetMs + (playback.Paused ? 0 : (_time.GetUtcNow() - playback.At).TotalMilliseconds)) / 1000);

    // The receiver isn't a Plex client, so what it plays is reported to the server here, as watched on the account that started it.
    private Task ReportAsync(AirPlayPlayback playback, string state, long? timeMs = null) =>
        _timeline.ReportAsync(playback.AccountId, playback.ItemId, state, timeMs ?? PositionSeconds(playback) * 1000L, playback.DurationMs);

    public async Task StartedAsync(AirPlayPlayback playback)
    {
        var started = playback with { At = _time.GetUtcNow() };
        await SetAsync(started);
        await ReportAsync(started, "playing");
    }

    public Task PausedAsync(string deviceId, bool paused)
    {
        if (_playing.GetValueOrDefault(deviceId) is not { } playback || playback.Paused == paused) return Task.CompletedTask;
        var now = _time.GetUtcNow();
        var changed = playback with { Paused = paused, OffsetMs = PositionSeconds(playback) * 1000L, At = now };
        return Task.WhenAll(SetAsync(changed), ReportAsync(changed, paused ? "paused" : "playing"));
    }

    public async Task StoppedAsync(string deviceId)
    {
        _queues.TryRemove(deviceId, out _);
        if (_playing.TryRemove(deviceId, out var playing))
        {
            await PushAsync();
            await ReportAsync(playing, "stopped");
        }
    }

    private async Task SetAsync(AirPlayPlayback playback)
    {
        _playing[playback.DeviceId] = playback;
        await PushAsync();
    }

    private void OnEnded(string deviceId) => _ = EndedAsync(deviceId);

    private async Task EndedAsync(string deviceId)
    {
        if (_playing.GetValueOrDefault(deviceId) is { } playing && Advance is { } advance && Finished(playing))
        {
            // A finished track is watched whatever the count says; the next one replaces it.
            await ReportAsync(playing, "stopped", playing.DurationMs);
            if (await advance(deviceId)) return;
            _queues.TryRemove(deviceId, out _);
            if (_playing.TryRemove(deviceId, out _)) await PushAsync();
            return;
        }
        await StoppedAsync(deviceId);
    }

    private bool Finished(AirPlayPlayback playing) =>
        playing is { DurationMs: > 0, Paused: false }
        && TimeSpan.FromSeconds(PositionSeconds(playing)) >= TimeSpan.FromMilliseconds(playing.DurationMs) - FinishedWithin;

    private async Task PushAsync()
    {
        try
        {
            await _hub.Clients.All.SendAsync("AirPlayNow", All);
        }
        catch (Exception e)
        {
            _log.LogWarning(e, "Could not push what plays on AirPlay");
        }
    }

    public void Dispose() => _airPlay.Ended -= OnEnded;
}
