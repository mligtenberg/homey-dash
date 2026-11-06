using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;

namespace HomeyDash.Api.Plex;

/// <summary>
/// plex.tv and a Plex Media Server over their HTTP APIs, as JSON. Signing in uses plex.tv's PIN flow: HomeyDash makes a
/// pin, someone approves it on app.plex.tv, and HomeyDash picks up the account's token. Players are controlled through
/// the server's /player API, which passes the command on to the player.
/// </summary>
public sealed class PlexClient(IHttpClientFactory httpFactory, TimeProvider time) : IPlex
{
    public const string HttpClientName = "Plex";
    public const string Product = "HomeyDash";

    private const string PlexTv = "https://plex.tv/api/v2/";

    // Each command to a player carries a number that goes up.
    private int _commandId;

    private HttpClient Http() => httpFactory.CreateClient(HttpClientName);

    public async Task<PlexPin> CreatePinAsync(string clientId, CancellationToken ct)
    {
        var json = await SendAsync(HttpMethod.Post, PlexTv + "pins?strong=true", clientId, null, ct);
        var code = json.GetProperty("code").GetString()!;
        var auth = "https://app.plex.tv/auth#?" + string.Join('&',
            $"clientID={Uri.EscapeDataString(clientId)}",
            $"code={Uri.EscapeDataString(code)}",
            $"context%5Bdevice%5D%5Bproduct%5D={Product}");
        return new PlexPin(json.GetProperty("id").GetInt64(), code, new Uri(auth));
    }

    public async Task<string?> CheckPinAsync(string clientId, long pinId, CancellationToken ct)
    {
        var json = await SendAsync(HttpMethod.Get, $"{PlexTv}pins/{pinId}", clientId, null, ct);
        return json.TryGetProperty("authToken", out var token) && token.ValueKind == JsonValueKind.String ? token.GetString() : null;
    }

    public async Task<string?> UsernameAsync(string clientId, string token, CancellationToken ct)
    {
        var json = await SendAsync(HttpMethod.Get, PlexTv + "user", clientId, token, ct);
        return Str(json, "username") ?? Str(json, "title");
    }

    public async Task<IReadOnlyList<PlexServerChoice>> ServersAsync(string clientId, string token, CancellationToken ct)
    {
        var json = await SendAsync(HttpMethod.Get, PlexTv + "resources?includeHttps=1&includeRelay=1", clientId, token, ct);
        return json.EnumerateArray()
            .Where(r => Str(r, "provides")?.Split(',').Contains("server") == true)
            .Select(r => new PlexServerChoice(
                Str(r, "clientIdentifier")!, Str(r, "name") ?? "Plex Media Server",
                r.TryGetProperty("owned", out var owned) && owned.ValueKind == JsonValueKind.True,
                Str(r, "accessToken") ?? token,
                r.TryGetProperty("connections", out var connections)
                    ? connections.EnumerateArray().Select(c => new PlexServerAddress(Str(c, "uri")!,
                        c.TryGetProperty("local", out var local) && local.ValueKind == JsonValueKind.True,
                        c.TryGetProperty("relay", out var relay) && relay.ValueKind == JsonValueKind.True)).ToList()
                    : []))
            .ToList();
    }

    public async Task<string> ConnectAsync(string clientId, PlexServerChoice server, CancellationToken ct)
    {
        // Local first, then remote, then plex.tv's relay, which is slow and limited.
        foreach (var address in server.Addresses.OrderBy(a => a.Relay).ThenByDescending(a => a.Local))
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(4));
            try
            {
                await SendAsync(HttpMethod.Get, address.Uri.TrimEnd('/') + "/identity", clientId, server.AccessToken, timeout.Token);
                return address.Uri.TrimEnd('/');
            }
            catch (Exception e) when (e is PlexException or OperationCanceledException && !ct.IsCancellationRequested)
            {
                // Try the next address.
            }
        }
        throw new PlexException($"None of {server.Name}'s addresses answer. Check that the server is running and HomeyDash can reach it.");
    }

    public async Task<IReadOnlyList<PlexSession>> SessionsAsync(PlexConnection server, CancellationToken ct)
    {
        var json = await ServerAsync(server, HttpMethod.Get, "/status/sessions", ct);
        var now = time.GetUtcNow();
        return Metadata(json).Select(m =>
        {
            var player = m.TryGetProperty("Player", out var p) ? p : default;
            var playerId = Str(player, "machineIdentifier") ?? "";
            return new PlexSession(
                Str(m, "sessionKey") ?? Str(m, "ratingKey") ?? playerId,
                Kind(Str(m, "type")),
                Str(m, "title") ?? "",
                Subtitle(m),
                Str(m, "grandparentThumb") ?? Str(m, "parentThumb") ?? Str(m, "thumb"),
                Str(m, "art") ?? Str(m, "grandparentArt"),
                Long(m, "duration"), Long(m, "viewOffset"), now,
                Str(player, "state") ?? "playing",
                m.TryGetProperty("User", out var user) ? Str(user, "title") : null,
                playerId,
                Str(player, "title") ?? Str(player, "product") ?? "Player");
        }).ToList();
    }

    public async Task<IReadOnlyList<PlexLibrary>> LibrariesAsync(PlexConnection server, int recent, CancellationToken ct)
    {
        var json = await ServerAsync(server, HttpMethod.Get, "/library/sections", ct);
        var sections = json.GetProperty("MediaContainer").TryGetProperty("Directory", out var d) ? d.EnumerateArray().ToList() : [];
        List<PlexLibrary> libraries = [];
        foreach (var section in sections.Where(s => Str(s, "type") is "movie" or "show" or "artist"))
        {
            var key = Str(section, "key")!;
            var items = await ServerAsync(server, HttpMethod.Get,
                $"/library/sections/{Uri.EscapeDataString(key)}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size={recent}", ct);
            libraries.Add(new PlexLibrary(key, Str(section, "title") ?? key, Str(section, "type")!, Metadata(items).Select(ToItem).ToList()));
        }
        return libraries;
    }

    public async Task<IReadOnlyList<PlexItem>> SearchAsync(PlexConnection server, string query, string? libraryId, int limit, CancellationToken ct)
    {
        var path = $"/hubs/search?query={Uri.EscapeDataString(query)}&limit={limit}"
            + (libraryId is null ? "" : $"&sectionId={Uri.EscapeDataString(libraryId)}");
        var json = await ServerAsync(server, HttpMethod.Get, path, ct);
        if (!json.GetProperty("MediaContainer").TryGetProperty("Hub", out var hubs) || hubs.ValueKind != JsonValueKind.Array) return [];
        // One list per kind (movies, shows, episodes...); keep the ones a card can show, in the server's order.
        return hubs.EnumerateArray()
            .Where(hub => hub.TryGetProperty("Metadata", out _))
            .SelectMany(hub => hub.GetProperty("Metadata").EnumerateArray())
            .Where(m => Str(m, "type") is "movie" or "show" or "season" or "episode" or "album")
            .Select(ToItem)
            .DistinctBy(i => i.Id)
            .Take(limit * 3)
            .ToList();
    }

    public async Task<PlexItem?> ItemAsync(PlexConnection server, string itemId, CancellationToken ct)
    {
        var json = await ServerAsync(server, HttpMethod.Get, $"/library/metadata/{Uri.EscapeDataString(itemId)}", ct);
        return Metadata(json).Select(ToItem).FirstOrDefault();
    }

    public async Task<PlexTracks> TracksAsync(PlexConnection server, string itemId, CancellationToken ct)
    {
        var json = await ServerAsync(server, HttpMethod.Get, $"/library/metadata/{Uri.EscapeDataString(itemId)}", ct);
        var streams = Metadata(json).FirstOrDefault() is { ValueKind: JsonValueKind.Object } m
            && m.TryGetProperty("Media", out var media) && media.ValueKind == JsonValueKind.Array && media.GetArrayLength() > 0
            && media[0].TryGetProperty("Part", out var parts) && parts.ValueKind == JsonValueKind.Array && parts.GetArrayLength() > 0
            && parts[0].TryGetProperty("Stream", out var s) && s.ValueKind == JsonValueKind.Array
                ? s.EnumerateArray().ToList()
                : [];
        List<PlexTrack> Of(long type) => streams.Where(x => Long(x, "streamType") == type).Select(x => new PlexTrack(
            Long(x, "id").ToString(),
            Str(x, "extendedDisplayTitle") ?? Str(x, "displayTitle") ?? Str(x, "language") ?? "Unknown",
            x.TryGetProperty("selected", out var selected) && selected.ValueKind == JsonValueKind.True)).ToList();
        return new PlexTracks(Of(2), Of(3));
    }

    private static PlexItem ToItem(JsonElement m) => new(
        Str(m, "ratingKey") ?? "",
        Kind(Str(m, "type")),
        Str(m, "type") == "season" ? Str(m, "parentTitle") ?? "" : Str(m, "title") ?? "",
        Str(m, "type") == "season" ? Str(m, "title") : Subtitle(m),
        Str(m, "grandparentThumb") ?? Str(m, "parentThumb") ?? Str(m, "thumb"),
        DateTimeOffset.FromUnixTimeSeconds(Long(m, "addedAt")))
    {
        Summary = Summary(Str(m, "summary")),
        Year = Long(m, "year") is > 0 and var year ? (int)year : null,
        DurationMs = Long(m, "duration") is > 0 and var duration ? duration : null,
        Rating = Number(m, "audienceRating") ?? Number(m, "rating"),
        ContentRating = Str(m, "contentRating"),
        Genres = m.TryGetProperty("Genre", out var genres) && genres.ValueKind == JsonValueKind.Array
            ? genres.EnumerateArray().Select(g => Str(g, "tag")).OfType<string>().Take(3).ToList()
            : [],
        Art = Str(m, "grandparentArt") ?? Str(m, "art"),
    };

    public async Task<(Stream Content, string ContentType)?> ImageAsync(PlexConnection server, string path, int width, int height, CancellationToken ct)
    {
        var url = QueryHelpers.AddQueryString(server.Uri + "/photo/:/transcode", new Dictionary<string, string?>
        {
            ["width"] = width.ToString(), ["height"] = height.ToString(), ["minSize"] = "1", ["upscale"] = "1", ["url"] = path,
        });
        var request = Request(HttpMethod.Get, url, server.ClientId, server.Token);
        HttpResponseMessage response;
        try
        {
            response = await Http().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (HttpRequestException e)
        {
            throw Unreachable(e);
        }
        if (!response.IsSuccessStatusCode)
        {
            response.Dispose();
            return null;
        }
        return (await response.Content.ReadAsStreamAsync(ct), response.Content.Headers.ContentType?.MediaType ?? "image/jpeg");
    }

    public async Task ControlAsync(PlexConnection server, string playerId, PlexCommand command, string kind, CancellationToken ct)
    {
        var verb = command switch
        {
            PlexCommand.Play => "play", PlexCommand.Pause => "pause",
            PlexCommand.SkipNext => "skipNext", _ => "skipPrevious",
        };
        var type = kind == "track" ? "music" : "video";
        using var request = Request(HttpMethod.Get,
            $"{server.Uri}/player/playback/{verb}?type={type}&commandID={Interlocked.Increment(ref _commandId)}", server.ClientId, server.Token);
        request.Headers.Add("X-Plex-Target-Client-Identifier", playerId);
        HttpResponseMessage response;
        try
        {
            response = await Http().SendAsync(request, ct);
        }
        catch (HttpRequestException e)
        {
            throw Unreachable(e);
        }
        using (response)
        {
            if (!response.IsSuccessStatusCode)
                throw new PlexException(response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.BadRequest or HttpStatusCode.NotAcceptable
                    ? "This player doesn't take remote control. Turn on Advertise as player in its settings, or use another player."
                    : $"The Plex server answered {(int)response.StatusCode} to controlling the player.");
        }
    }

    private static HttpRequestMessage Request(HttpMethod method, string url, string clientId, string? token)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.Add("X-Plex-Product", Product);
        request.Headers.Add("X-Plex-Client-Identifier", clientId);
        if (token is not null) request.Headers.Add("X-Plex-Token", token);
        return request;
    }

    private Task<JsonElement> ServerAsync(PlexConnection server, HttpMethod method, string path, CancellationToken ct) =>
        SendAsync(method, server.Uri + path, server.ClientId, server.Token, ct);

    private async Task<JsonElement> SendAsync(HttpMethod method, string url, string clientId, string? token, CancellationToken ct)
    {
        using var request = Request(method, url, clientId, token);
        HttpResponseMessage response;
        try
        {
            response = await Http().SendAsync(request, ct);
        }
        catch (HttpRequestException e)
        {
            throw Unreachable(e);
        }
        using (response)
        {
            if (response.StatusCode == HttpStatusCode.Unauthorized)
                throw new PlexException("Plex no longer accepts HomeyDash's sign-in. Sign in with Plex again under Accounts.");
            if (!response.IsSuccessStatusCode)
                throw new PlexException($"Plex answered {(int)response.StatusCode} to {new Uri(url).AbsolutePath}.");
            try
            {
                // Parsed from the stream: no string copy of the whole answer, and Plex is asked every few seconds.
                if (response.Content.Headers.ContentLength == 0) return default;
                await using var body = await response.Content.ReadAsStreamAsync(ct);
                return await JsonSerializer.DeserializeAsync<JsonElement?>(body, cancellationToken: ct) ?? default;
            }
            catch (JsonException e)
            {
                throw new PlexException("Plex answered something HomeyDash doesn't understand.", e);
            }
        }
    }

    private static PlexException Unreachable(HttpRequestException e) =>
        new("Could not reach Plex. Check that the server is running and HomeyDash can reach it.", e);

    private static IEnumerable<JsonElement> Metadata(JsonElement json) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty("MediaContainer", out var container)
        && container.TryGetProperty("Metadata", out var metadata) ? metadata.EnumerateArray() : [];

    private static string Kind(string? type) => type switch
    {
        "movie" or "episode" or "track" or "season" or "album" or "show" => type,
        _ => "other",
    };

    // An episode's show and number, a track's artist and album, a movie's year.
    private static string? Subtitle(JsonElement m) => Str(m, "type") switch
    {
        "episode" => string.Join(" · ", new[]
        {
            Str(m, "grandparentTitle"),
            m.TryGetProperty("parentIndex", out _) && m.TryGetProperty("index", out _) ? $"S{Long(m, "parentIndex")} E{Long(m, "index")}" : null,
        }.OfType<string>()),
        "track" => string.Join(" — ", new[] { Str(m, "grandparentTitle"), Str(m, "parentTitle") }.OfType<string>()),
        "album" => Str(m, "parentTitle"),
        "movie" or "show" => m.TryGetProperty("year", out _) ? Long(m, "year").ToString() : null,
        _ => null,
    };

    // A summary is a paragraph or two; the detail view shows a few lines of it.
    private static string? Summary(string? text) =>
        string.IsNullOrWhiteSpace(text) ? null : text.Length <= 600 ? text.Trim() : text[..600].TrimEnd() + "…";

    private static double? Number(JsonElement json, string name) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number
            ? Math.Round(value.GetDouble(), 1)
            : null;

    private static long Long(JsonElement json, string name) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty(name, out var value)
            ? value.ValueKind == JsonValueKind.Number ? value.GetInt64() : long.TryParse(value.GetString(), out var n) ? n : 0
            : 0;

    private static string? Str(JsonElement json, string name) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty(name, out var value)
            ? value.ValueKind switch { JsonValueKind.String => value.GetString(), JsonValueKind.Number => value.GetRawText(), _ => null }
            : null;
}
