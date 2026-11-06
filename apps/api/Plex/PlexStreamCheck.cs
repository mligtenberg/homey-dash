using Microsoft.AspNetCore.WebUtilities;

namespace HomeyDash.Api.Plex;

// One request an Apple TV would make while playing: the path (never the query, which holds the token), what the server
// answered, and whether the address carried the token itself.
public sealed record StreamRequest(string What, string Path, int? Status, string? ContentType, bool CarriesToken, string? Error);

// What the Plex server serves for a stream, as an Apple TV would fetch it. Host is where the receiver has to reach it.
public sealed record StreamCheck(string Host, string Scheme, bool Ok, string Summary, PlexSource Source, bool CopiesVideo, IReadOnlyList<StreamRequest> Requests);

/// <summary>
/// Fetches the stream the way the receiver would, before it is sent there: the playlist, then the first playlist and
/// segment it names, each by exactly the address the playlist gives. A receiver that cannot fetch them starts and stops
/// at once, with nothing to say why; this says why. It starts a transcode on the server and stops it again.
/// </summary>
public static class PlexStreamCheck
{
    /// <summary>The stream as it will be sent: the receiver's address, what the item is made of, and what is done with it.</summary>
    public static async Task<StreamCheck> RunAsync(HttpClient http, PlexConnection server, string itemId, CancellationToken ct, bool audio = false)
    {
        var (receiver, source, copy) = await PlexStream.PrepareAsync(http, server, itemId, ct);
        var session = Guid.NewGuid().ToString("N");
        var url = audio ? PlexStream.AudioUrl(receiver, itemId, session) : PlexStream.Url(receiver, itemId, session, copy);
        return await RunAsync(http, receiver, url, session, source, copy, ct);
    }

    public static async Task<StreamCheck> RunAsync(
        HttpClient http, PlexConnection server, string url, string session, PlexSource source, bool copy, CancellationToken ct)
    {
        var master = new Uri(url);
        List<StreamRequest> requests = [];
        try
        {
            // A track is one stream, not a playlist of segments: it answers, or it doesn't.
            if (master.AbsolutePath.StartsWith("/audio/", StringComparison.Ordinal))
            {
                var (status, _) = await FetchAsync(http, "audio stream", master, ct, requests, readBody: false);
                return status is 200 or 206
                    ? Result(master, true, "Plex serves the stream.", source, copy, requests)
                    : Result(master, false, $"Plex did not give the stream ({Describe(status)}).", source, copy, requests);
            }
            var (first, body) = await FetchAsync(http, "playlist", master, ct, requests);
            if (body is null) return Result(master, false, $"Plex did not give the stream ({Describe(first)}).", source, copy, requests);

            // The playlist names its variants, and a variant its segments: follow the first of each, as given.
            var variant = Next(master, body);
            if (variant is null) return Result(master, false, "Plex's playlist names nothing to play.", source, copy, requests);
            var (second, variantBody) = await FetchAsync(http, "variant playlist", variant, ct, requests);
            if (variantBody is null)
                return Result(master, false, $"Plex's playlist points at an address that does not answer ({Describe(second)}).", source, copy, requests);

            var segment = Next(variant, variantBody);
            if (segment is not null)
            {
                var (third, _) = await FetchAsync(http, "first segment", segment, ct, requests, readBody: false);
                if (third is not 200 and not 206)
                    return Result(master, false, $"Plex does not serve the first segment ({Describe(third)}).", source, copy, requests);
            }
            return Result(master, true, "Plex serves the stream.", source, copy, requests);
        }
        finally
        {
            await StopAsync(http, server, session, new Uri(url).AbsolutePath.StartsWith("/audio/", StringComparison.Ordinal));
        }
    }

    private static StreamCheck Result(Uri master, bool ok, string summary, PlexSource source, bool copy, List<StreamRequest> requests)
    {
        var failed = requests.LastOrDefault(r => r.Status is not (200 or 206));
        var hint = failed is { CarriesToken: false, Status: 401 or 403 }
            ? " The address the playlist gives carries no token, so a receiver cannot fetch it."
            : "";
        return new StreamCheck(master.Authority, master.Scheme, ok, summary + hint, source, copy, requests);
    }

    private static string Describe(int? status) => status is null ? "no answer" : $"HTTP {status}";

    // The first address a playlist names, resolved against the playlist's own.
    private static Uri? Next(Uri playlist, string body)
    {
        var line = body.Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0 && !l.StartsWith('#'));
        return line is not null && Uri.TryCreate(playlist, line, out var next) ? next : null;
    }

    private static async Task<(int? Status, string? Body)> FetchAsync(
        HttpClient http, string what, Uri uri, CancellationToken ct, List<StreamRequest> requests, bool readBody = true)
    {
        var carries = QueryHelpers.ParseQuery(uri.Query).ContainsKey("X-Plex-Token");
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(20));
            using var response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            var status = (int)response.StatusCode;
            var type = response.Content.Headers.ContentType?.MediaType;
            requests.Add(new StreamRequest(what, uri.AbsolutePath, status, type, carries, null));
            if (!response.IsSuccessStatusCode) return (status, null);
            if (!readBody) return (status, "");
            var body = await response.Content.ReadAsStringAsync(timeout.Token);
            return (status, body);
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException && !ct.IsCancellationRequested)
        {
            requests.Add(new StreamRequest(what, uri.AbsolutePath, null, null, carries, e.GetType().Name));
            return (null, null);
        }
    }

    private static async Task StopAsync(HttpClient http, PlexConnection server, string session, bool audio)
    {
        try
        {
            var stop = QueryHelpers.AddQueryString(server.Uri + (audio ? "/audio" : "/video") + "/:/transcode/universal/stop",
                new Dictionary<string, string?> { ["session"] = session, ["X-Plex-Token"] = server.Token });
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            using var _ = await http.GetAsync(stop, timeout.Token);
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException)
        {
            // The server ends an idle transcode by itself.
        }
    }
}
