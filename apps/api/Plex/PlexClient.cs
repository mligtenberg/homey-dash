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

    public async Task<IReadOnlyList<PlexProfile>> ProfilesAsync(string clientId, string token, CancellationToken ct)
    {
        // plex.tv's home users answer in XML.
        var xml = await SendXmlAsync(HttpMethod.Get, "https://plex.tv/api/home/users", clientId, token, null, ct);
        return xml.Descendants("User")
            .Where(u => u.Attribute("id") is not null)
            .Select(u => new PlexProfile((string)u.Attribute("id")!, (string?)u.Attribute("title") ?? (string?)u.Attribute("username") ?? "Profile",
                (string?)u.Attribute("admin") == "1", (string?)u.Attribute("protected") == "1"))
            .ToList();
    }

    public async Task<string> SwitchProfileAsync(string clientId, string token, string profileId, string? pin, CancellationToken ct)
    {
        var url = $"https://plex.tv/api/home/users/{Uri.EscapeDataString(profileId)}/switch";
        if (!string.IsNullOrEmpty(pin)) url = QueryHelpers.AddQueryString(url, "pin", pin);
        var xml = await SendXmlAsync(HttpMethod.Post, url, clientId, token, "That PIN is not right.", ct);
        return (string?)xml.Attribute("authenticationToken") ?? (string?)xml.Attribute("authToken")
            ?? throw new PlexException("Plex did not hand over that profile.");
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
        JsonElement json;
        try
        {
            json = await ServerAsync(server, HttpMethod.Get, "/status/sessions", ct);
        }
        catch (PlexForbiddenException)
        {
            // Only the server's owner sees what plays; any other profile sees the libraries and nothing playing.
            return [];
        }
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
            // The newest films, series or albums, and with them how many there are.
            var titles = await ServerAsync(server, HttpMethod.Get, LibraryPath(key, Str(section, "type")!, 0, recent, "addedAt:desc"), ct);
            libraries.Add(new PlexLibrary(key, Str(section, "title") ?? key, Str(section, "type")!, Metadata(items).Select(ToItem).ToList())
            {
                Count = (int)TotalSize(titles),
                Titles = Metadata(titles).Select(ToItem).ToList(),
            });
        }
        return libraries;
    }

    // What a library holds at the top: films, series, and for music its albums (type 9), by sort title.
    private static string LibraryPath(string libraryId, string libraryType, int start, int size, string sort = "titleSort") =>
        $"/library/sections/{Uri.EscapeDataString(libraryId)}/all?{(libraryType == "artist" ? "type=9&" : "")}sort={Uri.EscapeDataString(sort)}"
        + $"&X-Plex-Container-Start={start}&X-Plex-Container-Size={size}";

    public async Task<PlexPage> LibraryItemsAsync(PlexConnection server, string libraryId, string libraryType, int start, int size, CancellationToken ct)
    {
        var json = await ServerAsync(server, HttpMethod.Get, LibraryPath(libraryId, libraryType, start, size), ct);
        return new PlexPage(Metadata(json).Select(ToItem).ToList(), (int)TotalSize(json));
    }

    private static long TotalSize(JsonElement json) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty("MediaContainer", out var container) ? Long(container, "totalSize") : 0;

    public async Task<IReadOnlyList<PlexItem>> SearchAsync(PlexConnection server, string query, string? libraryId, int limit, CancellationToken ct)
    {
        var path = $"/hubs/search?query={Uri.EscapeDataString(query)}&limit={limit}"
            + (libraryId is null ? "" : $"&sectionId={Uri.EscapeDataString(libraryId)}");
        var json = await ServerAsync(server, HttpMethod.Get, path, ct);
        if (!json.GetProperty("MediaContainer").TryGetProperty("Hub", out var hubs) || hubs.ValueKind != JsonValueKind.Array) return [];
        // One list per kind (movies, shows, episodes...); keep the ones a card can show, in the server's order. Seasons are
        // reached through their show. Plex also lists an episode under its show's name and a track under its album's: only
        // the ones named by their own title stay.
        return hubs.EnumerateArray()
            .Where(hub => hub.TryGetProperty("Metadata", out _))
            .SelectMany(hub => hub.GetProperty("Metadata").EnumerateArray())
            .Where(m => Str(m, "type") is "movie" or "show" or "album"
                || (Str(m, "type") is "episode" or "track" && PlexSearch.Matches(Str(m, "title") ?? "", query)))
            .Select(ToItem)
            .DistinctBy(i => i.Id)
            .Take(limit * 5)
            .ToList();
    }

    public async Task<IReadOnlyList<PlexItem>> ChildrenAsync(PlexConnection server, string itemId, CancellationToken ct)
    {
        var json = await ServerAsync(server, HttpMethod.Get, $"/library/metadata/{Uri.EscapeDataString(itemId)}/children", ct);
        return Metadata(json).Where(m => Str(m, "type") is "season" or "episode" or "track").Select(ToChild).ToList();
    }

    public async Task<PlexItem?> ItemAsync(PlexConnection server, string itemId, CancellationToken ct)
    {
        var json = await ServerAsync(server, HttpMethod.Get, $"/library/metadata/{Uri.EscapeDataString(itemId)}", ct);
        return Metadata(json).Select(ToItem).FirstOrDefault();
    }

    public async Task<PlexPerson> PersonAsync(PlexConnection server, PlexActor actor, CancellationToken ct)
    {
        var works = new List<PlexItem>();
        if (actor.Id is { Length: > 0 } id)
        {
            var sections = (await ServerAsync(server, HttpMethod.Get, "/library/sections", ct)).GetProperty("MediaContainer");
            foreach (var section in sections.TryGetProperty("Directory", out var d) ? d.EnumerateArray() : [])
            {
                if (Str(section, "type") is not ("movie" or "show")) continue;
                var json = await ServerAsync(server, HttpMethod.Get,
                    $"/library/sections/{Uri.EscapeDataString(Str(section, "key")!)}/all?actor={Uri.EscapeDataString(id)}&sort=year:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=100", ct);
                works.AddRange(Metadata(json).Select(ToItem));
            }
        }
        string? bio = null, born = null, died = null, place = null, roles = null;
        // plex.tv knows the person's biography. It is a nicety: without it, or without its answer, the works still show.
        if (actor.Key is { Length: > 0 } key)
        {
            try
            {
                var json = await SendAsync(HttpMethod.Get, $"https://discover.provider.plex.tv/library/people/{Uri.EscapeDataString(key)}", server.ClientId, server.Token, ct);
                if (Metadata(json).FirstOrDefault() is { ValueKind: JsonValueKind.Object } p)
                {
                    bio = Str(p, "summary") is { Length: > 0 } summary ? summary.Trim() : null;
                    var bornOn = Day(Str(p, "bornAt"));
                    var diedOn = Day(Str(p, "diedAt"));
                    born = bornOn is { } b ? $"{Written(b)}{(diedOn is null ? $" ({Age(b, time.GetUtcNow())} years)" : "")}" : null;
                    died = diedOn is { } d ? $"{Written(d)}{(bornOn is { } b2 ? $" (aged {Age(b2, d)})" : "")}" : null;
                    place = Str(p, "birthPlace") is { Length: > 0 } birthPlace ? birthPlace : null;
                    roles = p.TryGetProperty("CreditType", out var credits) && credits.ValueKind == JsonValueKind.Array
                        ? string.Join(", ", credits.EnumerateArray().Select(c => Str(c, "title")).OfType<string>()) is { Length: > 0 } list ? list : null
                        : null;
                }
            }
            catch (PlexException)
            {
            }
        }
        return new PlexPerson(actor.Name, actor.Image, bio, born, died, place, roles, works.DistinctBy(w => w.Id).OrderByDescending(w => w.Year ?? 0).ToList());
    }

    private static DateOnly? Day(string? date) =>
        DateOnly.TryParse(date, System.Globalization.CultureInfo.InvariantCulture, out var day) ? day : null;

    private static string Written(DateOnly day) => day.ToString("d MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture);

    private static int Age(DateOnly born, DateOnly on) => on.Year - born.Year - (on < born.AddYears(on.Year - born.Year) ? 1 : 0);

    private static int Age(DateOnly born, DateTimeOffset now) => Age(born, DateOnly.FromDateTime(now.UtcDateTime));

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

    // Under its show, season, or album, an item is told by its own name and number.
    private static PlexItem ToChild(JsonElement m)
    {
        var type = Str(m, "type");
        return ToItem(m) with
        {
            Title = Str(m, "title") ?? "",
            Subtitle = type switch
            {
                "season" => Long(m, "leafCount") is > 0 and var n ? n == 1 ? "1 episode" : $"{n} episodes" : null,
                // The artist, when the album's tracks have different ones.
                "track" => Str(m, "originalTitle"),
                _ => null,
            },
            Image = type == "season" ? Str(m, "thumb") ?? Str(m, "parentThumb") : ToItem(m).Image,
            Index = Long(m, "index") is > 0 and var index ? (int)index : null,
        };
    }

    // An album's cover is its own picture; its parent's is the artist's.
    private static string? Thumb(JsonElement m) => Str(m, "type") switch
    {
        "album" => Str(m, "thumb") ?? Str(m, "parentThumb"),
        "track" => Str(m, "parentThumb") ?? Str(m, "thumb") ?? Str(m, "grandparentThumb"),
        _ => Str(m, "grandparentThumb") ?? Str(m, "parentThumb") ?? Str(m, "thumb"),
    };

    private static PlexItem ToItem(JsonElement m) => new(
        Str(m, "ratingKey") ?? "",
        Kind(Str(m, "type")),
        Str(m, "type") == "season" ? Str(m, "parentTitle") ?? "" : Str(m, "title") ?? "",
        Str(m, "type") == "season" ? Str(m, "title") : Subtitle(m),
        Thumb(m),
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
        Cast = m.TryGetProperty("Role", out var roles) && roles.ValueKind == JsonValueKind.Array
            ? roles.EnumerateArray().Select(r => Str(r, "tag") is { Length: > 0 } name ? new PlexActor(name, Str(r, "role"), Str(r, "thumb"), Str(r, "id"), Str(r, "tagKey")) : null).OfType<PlexActor>().Take(40).ToList()
            : [],
        Art = Str(m, "grandparentArt") ?? Str(m, "art"),
        Watched = Str(m, "type") switch
        {
            "movie" or "episode" => Long(m, "viewCount") > 0,
            // A season or series is watched when every one of its episodes is.
            "season" or "show" => Long(m, "leafCount") is > 0 and var leaves && Long(m, "viewedLeafCount") >= leaves,
            _ => false,
        },
    };

    public async Task<PlexAudio?> AudioAsync(PlexConnection server, string itemId, bool theme, string? range, CancellationToken ct)
    {
        var json = await ServerAsync(server, HttpMethod.Get, $"/library/metadata/{Uri.EscapeDataString(itemId)}", ct);
        if (Metadata(json).FirstOrDefault() is not { ValueKind: JsonValueKind.Object } m) return null;
        string? path;
        if (theme) path = Str(m, "theme");
        else
            path = Str(m, "type") == "track" && m.TryGetProperty("Media", out var media) && media.ValueKind == JsonValueKind.Array && media.GetArrayLength() > 0
                && media[0].TryGetProperty("Part", out var parts) && parts.ValueKind == JsonValueKind.Array && parts.GetArrayLength() > 0
                    ? Str(parts[0], "key")
                    : null;
        // Only the library's own files, like the pictures.
        if (path is null || !(path.StartsWith("/library/parts/", StringComparison.Ordinal) || path.StartsWith("/library/metadata/", StringComparison.Ordinal))
            || path.Contains("..") || path.Contains('?')) return null;
        var request = Request(HttpMethod.Get, server.Uri + path, server.ClientId, server.Token);
        request.Headers.Accept.Clear();
        request.Headers.Accept.ParseAdd("*/*");
        if (range is not null) request.Headers.TryAddWithoutValidation("Range", range);
        HttpResponseMessage response;
        try
        {
            response = await Http().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (HttpRequestException e)
        {
            throw Unreachable(e);
        }
        if (response.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.PartialContent))
        {
            response.Dispose();
            return null;
        }
        // Plex calls an mp3 audio/mpeg3 at times, which is not a type a browser knows.
        var type = response.Content.Headers.ContentType?.MediaType is { } named && !named.Contains("mpeg3") ? named : "audio/mpeg";
        return new PlexAudio(await response.Content.ReadAsStreamAsync(ct), type,
            (int)response.StatusCode, response.Content.Headers.ContentLength, response.Content.Headers.ContentRange?.ToString());
    }

    public async Task ReportAsync(PlexConnection server, string itemId, string state, long timeMs, long durationMs, CancellationToken ct)
    {
        const string identifier = "com.plexapp.plugins.library";
        var key = $"/library/metadata/{Uri.EscapeDataString(itemId)}";
        await SendOkAsync(server, QueryHelpers.AddQueryString("/:/timeline", new Dictionary<string, string?>
        {
            ["ratingKey"] = itemId, ["key"] = key, ["identifier"] = identifier, ["state"] = state,
            ["time"] = timeMs.ToString(), ["duration"] = durationMs.ToString(),
        }), ct);
        if (state != "stopped") return;
        // The timeline alone leaves it to the server to notice a stop; saying so keeps the watched state and the resume point right.
        if (durationMs > 0 && timeMs >= durationMs * 9 / 10)
            await SendOkAsync(server, QueryHelpers.AddQueryString("/:/scrobble", new Dictionary<string, string?> { ["key"] = itemId, ["identifier"] = identifier }), ct);
        else if (timeMs > 0)
            await SendOkAsync(server, QueryHelpers.AddQueryString("/:/progress", new Dictionary<string, string?>
                { ["key"] = itemId, ["identifier"] = identifier, ["time"] = timeMs.ToString(), ["state"] = "stopped" }), ct);
    }

    private async Task SendOkAsync(PlexConnection server, string path, CancellationToken ct)
    {
        using var request = Request(HttpMethod.Get, server.Uri + path, server.ClientId, server.Token);
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
            if (!response.IsSuccessStatusCode) throw new PlexException($"The Plex server answered {(int)response.StatusCode} to a progress report.");
        }
    }

    public async Task<PlexAudio?> VideoAsync(PlexConnection server, string itemId, CancellationToken ct)
    {
        var json = await ServerAsync(server, HttpMethod.Get, $"/library/metadata/{Uri.EscapeDataString(itemId)}", ct);
        if (Metadata(json).FirstOrDefault() is not { ValueKind: JsonValueKind.Object } m || Str(m, "type") is not ("movie" or "episode")) return null;
        var request = Request(HttpMethod.Get, PlexStream.BrowserUrl(server, itemId), server.ClientId, server.Token);
        request.Headers.Accept.Clear();
        request.Headers.Accept.ParseAdd("*/*");
        HttpResponseMessage response;
        try
        {
            response = await Http().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (HttpRequestException e)
        {
            throw Unreachable(e);
        }
        if (response.StatusCode != HttpStatusCode.OK)
        {
            response.Dispose();
            return null;
        }
        // The transcoder streams until the video ends, so it has no length.
        return new PlexAudio(await response.Content.ReadAsStreamAsync(ct), "video/mp4", 200, null, null);
    }

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

    // plex.tv answers some of its older calls in XML only. badLogin is what a refusal (401, 403) says.
    private async Task<System.Xml.Linq.XElement> SendXmlAsync(HttpMethod method, string url, string clientId, string? token, string? badLogin, CancellationToken ct)
    {
        using var request = Request(method, url, clientId, token);
        request.Headers.Accept.Clear();
        request.Headers.Accept.ParseAdd("application/xml");
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
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden && badLogin is not null) throw new PlexException(badLogin);
            if (!response.IsSuccessStatusCode) throw new PlexException($"plex.tv answered {(int)response.StatusCode}.");
            try
            {
                return System.Xml.Linq.XDocument.Parse(await response.Content.ReadAsStringAsync(ct)).Root ?? throw new PlexException("plex.tv answered nothing.");
            }
            catch (System.Xml.XmlException)
            {
                throw new PlexException("plex.tv's answer was not understood.");
            }
        }
    }

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
            if (response.StatusCode == HttpStatusCode.Forbidden)
                throw new PlexForbiddenException($"Plex answered 403 to {new Uri(url).AbsolutePath}.");
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
