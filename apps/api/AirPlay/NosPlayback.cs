using HomeyDash.AirPlay;
using HomeyDash.Api.News;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.AirPlay;

/// <summary>
/// Plays one of NOS's videos or livestreams on an AirPlay receiver (ADR-0012, ADR-0016), the way <see cref="PlexPlayback"/> plays
/// what Plex holds: the receiver fetches NOS's HLS stream itself, and <see cref="AirPlayNow"/> keeps what plays, so every screen
/// shows its controls. Failures are <see cref="HubException"/>s, whose message is what a screen shows.
/// </summary>
public sealed class NosPlayback(AirPlayOptions options, IAirPlay airPlay, AirPlayNow nowPlaying, INosVideos videos)
{
    /// <summary>What <see cref="AirPlayPlayback.Source"/> says of what plays from NOS.</summary>
    public const string Source = "nos";

    /// <param name="kind"><c>video</c> or <c>live</c>.</param>
    public async Task PlayAsync(string kind, string id, string deviceId, CancellationToken ct)
    {
        if (!options.Enabled) throw new HubException("AirPlay isn't set up.");
        try
        {
            string title, url;
            string? detail;
            long durationMs = 0;
            switch (kind)
            {
                case "video":
                    var video = (await videos.VideosAsync(ct)).FirstOrDefault(v => v.Id == id) ?? throw new HubException("NOS no longer lists that video.");
                    (title, detail, durationMs) = (video.Title, video.Category, (video.Seconds ?? 0) * 1000L);
                    url = await videos.StreamAsync(id, ct);
                    break;
                case "live":
                    var stream = (await videos.LiveAsync(ct)).FirstOrDefault(l => l.Id == id) ?? throw new HubException("NOS no longer lists that livestream.");
                    if (!stream.Live) throw new HubException("That livestream has not started yet.");
                    (title, detail, url) = (stream.Title, "Live", stream.Url);
                    break;
                default:
                    throw new HubException("Only a video or a livestream of NOS plays this way.");
            }
            await airPlay.PlayAsync(deviceId, url, ct);
            var name = (await airPlay.PairedAsync(ct)).FirstOrDefault(d => d.Id == deviceId)?.Name ?? deviceId;
            // What came before on the receiver, an album or a season, does not go on after this.
            nowPlaying.SetQueue(deviceId, null);
            await nowPlaying.StartedAsync(new AirPlayPlayback(deviceId, name, 0, $"{kind}:{id}", title, false, null, null, 0, default)
            {
                Source = Source,
                Detail = detail,
                DurationMs = durationMs,
            });
        }
        catch (NewsException e)
        {
            throw new HubException(e.Message);
        }
        catch (AirPlayException e)
        {
            throw new HubException(e.Message);
        }
    }
}
