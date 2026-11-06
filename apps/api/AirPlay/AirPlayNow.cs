using System.Collections.Concurrent;
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
    string? AudioStreamId, string? SubtitleStreamId, long OffsetMs, DateTimeOffset At);

/// <summary>
/// The playback every screen shows controls for: one place that knows what plays where, pushed to every connection as
/// <c>AirPlayNow</c> whenever it changes, so a screen that did not start it can pause or stop it too.
/// </summary>
public sealed class AirPlayNow : IDisposable
{
    private readonly ConcurrentDictionary<string, AirPlayPlayback> _playing = new();
    private readonly IHubContext<RealtimeHub> _hub;
    private readonly IAirPlay _airPlay;
    private readonly TimeProvider _time;
    private readonly ILogger<AirPlayNow> _log;

    public AirPlayNow(IHubContext<RealtimeHub> hub, IAirPlay airPlay, TimeProvider time, ILogger<AirPlayNow> log)
    {
        _hub = hub;
        _airPlay = airPlay;
        _time = time;
        _log = log;
        // The Apple TV stopping or finishing, or someone stopping it with its remote, ends it for every screen.
        _airPlay.Ended += OnEnded;
    }

    public IReadOnlyList<AirPlayPlayback> All => _playing.Values.OrderBy(p => p.DeviceName, StringComparer.OrdinalIgnoreCase).ToList();

    public AirPlayPlayback? Find(string deviceId) => _playing.GetValueOrDefault(deviceId);

    // Where it is now, in whole seconds from the start.
    public int PositionSeconds(AirPlayPlayback playback) =>
        (int)(Math.Max(0, playback.OffsetMs + (playback.Paused ? 0 : (_time.GetUtcNow() - playback.At).TotalMilliseconds)) / 1000);

    public Task StartedAsync(AirPlayPlayback playback) => SetAsync(playback with { At = _time.GetUtcNow() });

    public Task PausedAsync(string deviceId, bool paused)
    {
        if (_playing.GetValueOrDefault(deviceId) is not { } playback || playback.Paused == paused) return Task.CompletedTask;
        var now = _time.GetUtcNow();
        return SetAsync(playback with { Paused = paused, OffsetMs = PositionSeconds(playback) * 1000L, At = now });
    }

    public async Task StoppedAsync(string deviceId)
    {
        if (_playing.TryRemove(deviceId, out _)) await PushAsync();
    }

    private async Task SetAsync(AirPlayPlayback playback)
    {
        _playing[playback.DeviceId] = playback;
        await PushAsync();
    }

    private void OnEnded(string deviceId) => _ = StoppedAsync(deviceId);

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
