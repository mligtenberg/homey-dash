using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.WebUtilities;

namespace HomeyDash.Api.Plex;

// What a library item is made of, to decide what the server should do for an Apple TV.
public sealed record PlexSource(string? VideoCodec, string? AudioCodec, string? Container);

// Which audio and subtitle track the stream carries (Plex's stream ids; no subtitle id means none) and where it starts.
public sealed record PlexStreamChoice(string? AudioStreamId, string? SubtitleStreamId, int OffsetSeconds);

public static partial class PlexStream
{
    /// <summary>
    /// An HLS stream of a movie or episode that an Apple TV fetches itself, transcoded by the server as needed. The URL
    /// carries the account's token (ADR-0012), so it goes only to the receiver, never to a screen. An Apple TV plays
    /// H.264 in HLS, not every codec a library holds: the audio is always transcoded, and the video is only copied when
    /// it already is H.264.
    /// </summary>
    public static string Url(PlexConnection server, string itemId, string? session = null, bool copyVideo = true, PlexStreamChoice? choice = null)
    {
        // A subtitle is burned into the picture, which an Apple TV shows whatever the format, so the video can't be copied.
        var burn = choice?.SubtitleStreamId is not null;
        var query = new Dictionary<string, string?>
        {
            ["path"] = $"/library/metadata/{itemId}",
            ["mediaIndex"] = "0", ["partIndex"] = "0", ["protocol"] = "hls",
            ["directPlay"] = "0", ["directStream"] = copyVideo && !burn ? "1" : "0", ["directStreamAudio"] = "0",
            ["fastSeek"] = "1", ["maxVideoBitrate"] = "20000", ["videoQuality"] = "100",
            ["session"] = session ?? Guid.NewGuid().ToString("N"),
            ["X-Plex-Product"] = "HomeyDash", ["X-Plex-Platform"] = "tvOS",
            ["X-Plex-Client-Identifier"] = server.ClientId, ["X-Plex-Token"] = server.Token,
        };
        if (choice is not null)
        {
            if (choice.AudioStreamId is not null) query["audioStreamID"] = choice.AudioStreamId;
            query["subtitleStreamID"] = choice.SubtitleStreamId ?? "0";
            query["subtitles"] = burn ? "burn" : "none";
            if (choice.OffsetSeconds > 0) query["offset"] = choice.OffsetSeconds.ToString();
        }
        return QueryHelpers.AddQueryString(server.Uri + "/video/:/transcode/universal/start.m3u8", query);
    }

    /// <summary>
    /// A track as one mp3 stream the server makes of whatever the file holds, which an Apple TV plays; the URL carries the token
    /// for the same reason as <see cref="Url"/>. It is not HLS: Plex's audio transcoder serves one continuous stream whatever it
    /// is asked, and the HLS playlist it gives names segments that never exist.
    /// </summary>
    public static string AudioUrl(PlexConnection server, string trackId, string? session = null) =>
        QueryHelpers.AddQueryString(server.Uri + "/audio/:/transcode/universal/start.mp3", new Dictionary<string, string?>
        {
            ["path"] = $"/library/metadata/{trackId}",
            ["mediaIndex"] = "0", ["partIndex"] = "0", ["protocol"] = "http",
            ["session"] = session ?? Guid.NewGuid().ToString("N"),
            ["X-Plex-Product"] = "HomeyDash", ["X-Plex-Platform"] = "tvOS",
            ["X-Plex-Client-Identifier"] = server.ClientId, ["X-Plex-Token"] = server.Token,
        });

    /// <summary>
    /// A movie or episode as one fragmented mp4 a browser plays: H.264 and AAC, the server copying the video where it already is that.
    /// The URL carries the account's token, so it is fetched by the backend and never goes to a screen.
    /// </summary>
    public static string BrowserUrl(PlexConnection server, string itemId, string? session = null) =>
        QueryHelpers.AddQueryString(server.Uri + "/video/:/transcode/universal/start.mp4", new Dictionary<string, string?>
        {
            ["path"] = $"/library/metadata/{itemId}",
            ["mediaIndex"] = "0", ["partIndex"] = "0", ["protocol"] = "http", ["container"] = "mp4",
            ["directPlay"] = "0", ["directStream"] = "1", ["directStreamAudio"] = "0",
            ["videoCodec"] = "h264", ["audioCodec"] = "aac", ["subtitles"] = "none",
            ["maxVideoBitrate"] = "8000", ["videoQuality"] = "100",
            ["session"] = session ?? Guid.NewGuid().ToString("N"),
            ["X-Plex-Product"] = "HomeyDash", ["X-Plex-Platform"] = "Chrome",
            ["X-Plex-Client-Identifier"] = server.ClientId, ["X-Plex-Token"] = server.Token,
        });

    // Plex names a local address 192-168-1-23.<id>.plex.direct and serves it over https. A receiver has to resolve that
    // name through public DNS, which routers and DNS filters often refuse for a private address: the IP over http, which
    // a Plex server allows on the local network unless told to require secure connections, needs neither.
    [GeneratedRegex(@"^(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.[0-9a-f]+\.plex\.direct$", RegexOptions.IgnoreCase)]
    private static partial Regex PlexDirect();

    /// <summary>The server by its IP over http when that answers, so a receiver needs no DNS or certificate; else as it is.</summary>
    public static async Task<PlexConnection> ForReceiverAsync(HttpClient http, PlexConnection server, CancellationToken ct)
    {
        if (!Uri.TryCreate(server.Uri, UriKind.Absolute, out var uri) || PlexDirect().Match(uri.Host) is not { Success: true } m) return server;
        var plain = server with { Uri = $"http://{m.Groups[1]}.{m.Groups[2]}.{m.Groups[3]}.{m.Groups[4]}:{uri.Port}" };
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(3));
            using var response = await http.GetAsync(
                QueryHelpers.AddQueryString(plain.Uri + "/identity", "X-Plex-Token", plain.Token), timeout.Token);
            return response.IsSuccessStatusCode ? plain : server;
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException && !ct.IsCancellationRequested)
        {
            return server;
        }
    }

    /// <summary>The codecs of the item's first media, or nothing known when the server does not say.</summary>
    public static async Task<PlexSource> SourceAsync(HttpClient http, PlexConnection server, string itemId, CancellationToken ct)
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            var url = QueryHelpers.AddQueryString(server.Uri + $"/library/metadata/{itemId}", "X-Plex-Token", server.Token);
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Accept.ParseAdd("application/json");
            using var response = await http.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode) return new PlexSource(null, null, null);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
            var media = json.RootElement.GetProperty("MediaContainer").GetProperty("Metadata")[0].GetProperty("Media")[0];
            string? Text(string name) => media.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            return new PlexSource(Text("videoCodec"), Text("audioCodec"), Text("container"));
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or JsonException or KeyNotFoundException or InvalidOperationException
            && !ct.IsCancellationRequested)
        {
            return new PlexSource(null, null, null);
        }
    }

    /// <summary>What to send a receiver: the server as it reaches it, what the item is made of, and whether to copy its video.</summary>
    public static async Task<(PlexConnection Server, PlexSource Source, bool CopyVideo)> PrepareAsync(
        HttpClient http, PlexConnection server, string itemId, CancellationToken ct)
    {
        var receiver = await ForReceiverAsync(http, server, ct);
        var source = await SourceAsync(http, receiver, itemId, ct);
        return (receiver, source, CanCopyVideo(source));
    }

    // Only H.264 is copied; anything else, or nothing known, is transcoded to it.
    public static bool CanCopyVideo(PlexSource source) => string.Equals(source.VideoCodec, "h264", StringComparison.OrdinalIgnoreCase);
}
