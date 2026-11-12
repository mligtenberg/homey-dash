using System.Net;
using System.Runtime.CompilerServices;
using System.Text.Json;

namespace HomeyDash.Api.Photos;

/// <summary>
/// Immich over its REST API, with the account's API key in the x-api-key header. An album's photos come from
/// /search/metadata, since Immich 3 no longer lists them with the album. A selection draws from /search/smart when it
/// has a query, else from /search/random a batch at a time, so its first photos come quickly; for each wanted person, or
/// for anyone. It leaves out unwanted people's photos. Wanted people are drawn evenly: each next photo is one of whoever
/// is on the fewest drawn so far.
/// A photo's Version is its thumbhash, which Immich makes again when the photo is edited.
/// </summary>
public sealed class ImmichClient(IHttpClientFactory httpFactory, Random? random = null, TimeProvider? time = null) : IImmich
{
    public const string HttpClientName = "Immich";

    // Immich's largest page.
    private const int PageSize = 1000;

    // At most this many of someone's photos to leave out.
    private const int PersonLimit = 20_000;

    // Photos of someone asked for at once, at random.
    private const int DrawBatch = 50;

    // How long a rotation waits for Immich to turn the preview, and how often it looks.
    private static readonly TimeSpan PreviewWait = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan PreviewPoll = TimeSpan.FromMilliseconds(500);

    private readonly Random _random = random ?? Random.Shared;
    private readonly TimeProvider _time = time ?? TimeProvider.System;

    private HttpClient Http() => httpFactory.CreateClient(HttpClientName);

    // Immich's ping needs no key, so a server that refuses it, or answers something else, is not Immich.
    public async Task CheckAsync(ImmichAccount account, CancellationToken ct)
    {
        using var request = Request(account, HttpMethod.Get, "server/ping");
        string text;
        bool ok;
        try
        {
            using var response = await Http().SendAsync(request, ct);
            ok = response.IsSuccessStatusCode;
            text = await response.Content.ReadAsStringAsync(ct);
        }
        catch (HttpRequestException e)
        {
            throw Unreachable(account, e);
        }
        if (!ok || !text.Contains("pong", StringComparison.Ordinal))
            throw new ImmichException($"Something answers at {account.Address}, but it is not Immich. Check the address and port; Immich's own is 2283.");
        await AlbumsAsync(account, ct);
    }

    public async Task<ImmichUser> UserAsync(ImmichAccount account, CancellationToken ct) =>
        ToUser(await SendAsync(account, HttpMethod.Get, "users/me", null, ct));

    public async Task<IReadOnlyList<ImmichUser>> PartnersAsync(ImmichAccount account, CancellationToken ct) =>
        (await SendAsync(account, HttpMethod.Get, "partners?direction=shared-with", null, ct)).EnumerateArray()
            .Select(ToUser).OrderBy(u => u.Name, StringComparer.CurrentCultureIgnoreCase).ToList();

    // By name, or by email when it has none.
    private static ImmichUser ToUser(JsonElement user) =>
        new(user.GetProperty("id").GetString()!, Str(user, "name") is { Length: > 0 } name ? name : Str(user, "email") ?? "");

    public async Task<IReadOnlyList<ImmichAlbum>> AlbumsAsync(ImmichAccount account, CancellationToken ct)
    {
        var json = await SendAsync(account, HttpMethod.Get, "albums", null, ct);
        return json.EnumerateArray()
            .Select(a => new ImmichAlbum(a.GetProperty("id").GetString()!, a.GetProperty("albumName").GetString() ?? "",
                a.TryGetProperty("assetCount", out var count) ? count.GetInt32() : 0))
            .OrderBy(a => a.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    public async Task<ImmichAlbumContents?> AlbumAsync(ImmichAccount account, string albumId, CancellationToken ct)
    {
        if (!Guid.TryParse(albumId, out _)) return null;
        JsonElement album;
        try
        {
            album = await SendAsync(account, HttpMethod.Get, $"albums/{albumId}", null, ct);
        }
        catch (ImmichException e) when (e.InnerException is HttpRequestException { StatusCode: HttpStatusCode.NotFound or HttpStatusCode.BadRequest })
        {
            return null;
        }

        List<Photo> photos = [];
        var skipped = 0;
        foreach (var asset in await SearchAsync(account, "search/metadata", new() { ["albumIds"] = new[] { albumId }, ["withExif"] = true }, int.MaxValue, ct))
        {
            if (asset.GetProperty("type").GetString() == "IMAGE") photos.Add(ToPhoto(asset));
            else skipped++;
        }
        return new ImmichAlbumContents(album.GetProperty("albumName").GetString() ?? "", photos, skipped);
    }

    public async Task<IReadOnlyList<ImmichPerson>> PeopleAsync(ImmichAccount account, CancellationToken ct)
    {
        List<ImmichPerson> people = [];
        for (var page = 1; ; page++)
        {
            var json = await SendAsync(account, HttpMethod.Get, $"people?page={page}&size={PageSize}", null, ct);
            people.AddRange(json.GetProperty("people").EnumerateArray()
                .Where(p => !(p.TryGetProperty("isHidden", out var hidden) && hidden.GetBoolean()))
                .Select(p => new ImmichPerson(p.GetProperty("id").GetString()!, Str(p, "name") ?? ""))
                .Where(p => p.Name.Length > 0));
            if (!(json.TryGetProperty("hasNextPage", out var more) && more.GetBoolean())) break;
        }
        return people.OrderBy(p => p.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    public async IAsyncEnumerable<Photo> DrawAsync(
        ImmichAccount account, PhotoSelection selection, [EnumeratorCancellation] CancellationToken ct)
    {
        // A smart search has no people on its photos, so the unwanted people's are looked up for it. A random one has.
        HashSet<string> unwantedPhotos = [];
        if (selection.Query is not null)
            foreach (var person in selection.Without)
                foreach (var asset in await SearchAsync(account, "search/metadata", new() { ["personIds"] = new[] { person.Id } }, PersonLimit, ct))
                    unwantedPhotos.Add(Id(asset));
        var unwantedPeople = selection.Without.Select(p => p.Id).ToHashSet();

        // Anyone, under "", when no one is wanted.
        var sources = (selection.With.Count == 0 ? [""] : selection.With.Select(p => p.Id))
            .Distinct().ToDictionary(p => p, _ => new Source());
        Dictionary<string, HashSet<string>> on = [];
        HashSet<string> drawn = [];

        async Task FillAsync(string person, Source source)
        {
            Dictionary<string, object> filter = new() { ["type"] = "IMAGE", ["withExif"] = true };
            if (person.Length > 0) filter["personIds"] = new[] { person };
            List<JsonElement> found;
            if (selection.Query is { } query)
            {
                // A smart search ranks everything by how well it matches, so only the best twice as many as needed count.
                found = await SearchAsync(account, "search/smart", new(filter) { ["query"] = query }, Math.Min(selection.Count * 2, PageSize), ct);
                source.Done = true;
            }
            else
            {
                var size = person.Length > 0 ? DrawBatch : Math.Min(PageSize, Math.Max(DrawBatch, selection.Count));
                found = (await SendAsync(account, HttpMethod.Post, "search/random", new Dictionary<string, object>(filter) { ["size"] = size, ["withPeople"] = true }, ct))
                    .EnumerateArray().ToList();
                // Fewer than asked for is all of them.
                source.Done = found.Count < size;
            }
            var fresh = found
                .Where(a => a.GetProperty("type").GetString() == "IMAGE" && !Trashed(a) && !unwantedPhotos.Contains(Id(a)) && !PeopleOn(a).Overlaps(unwantedPeople))
                .Where(a => source.Had.Add(Id(a)))
                .ToArray();
            // None new: the batches only repeat what came before.
            if (fresh.Length == 0) source.Done = true;
            _random.Shuffle(fresh);
            foreach (var asset in fresh)
            {
                // A photo of several wanted people counts for each of them, also when another's batch brought it first.
                var people = on.TryGetValue(Id(asset), out var known) ? known : on[Id(asset)] = [];
                people.Add(person);
                people.UnionWith(PeopleOn(asset).Where(sources.ContainsKey));
                if (!drawn.Contains(Id(asset))) source.Waiting.Enqueue(asset);
            }
        }

        // Every smart search first, so a photo is known to be of everyone who has it before it counts.
        if (selection.Query is not null)
            foreach (var (person, source) in sources) await FillAsync(person, source);
        var shown = sources.Keys.ToDictionary(p => p, _ => 0);
        while (drawn.Count < selection.Count)
        {
            var open = sources.Where(s => s.Value.Waiting.Count > 0 || !s.Value.Done).Select(s => s.Key).ToArray();
            if (open.Length == 0) yield break;
            _random.Shuffle(open);
            var person = open.MinBy(p => shown[p])!;
            var source = sources[person];
            if (source.Waiting.Count == 0)
            {
                await FillAsync(person, source);
                continue;
            }
            var asset = source.Waiting.Dequeue();
            if (!drawn.Add(Id(asset))) continue;
            foreach (var p in on[Id(asset)]) shown[p]++;
            yield return ToPhoto(asset);
        }
    }

    // Someone's photos to draw from: those waiting their turn, every one that came so far, and whether more can come.
    private sealed class Source
    {
        public Queue<JsonElement> Waiting { get; } = new();
        public HashSet<string> Had { get; } = [];
        public bool Done { get; set; }
    }

    private static string Id(JsonElement asset) => asset.GetProperty("id").GetString()!;

    // Asked for with withPeople; none otherwise.
    private static HashSet<string> PeopleOn(JsonElement asset) =>
        asset.TryGetProperty("people", out var people) && people.ValueKind == JsonValueKind.Array
            ? people.EnumerateArray().Select(p => p.GetProperty("id").GetString()!).ToHashSet()
            : [];

    // Every asset a search finds, up to limit, leaving out the trashed. Pages by number up to Immich 3.1, and by cursor
    // from 3.2, which still answers a page number for the first.
    private async Task<List<JsonElement>> SearchAsync(
        ImmichAccount account, string path, Dictionary<string, object> filter, int limit, CancellationToken ct)
    {
        List<JsonElement> found = [];
        object? next = 1;
        while (next is not null && found.Count < limit)
        {
            var json = await SendAsync(account, HttpMethod.Post, path, new Dictionary<string, object>(filter)
            {
                ["size"] = Math.Min(PageSize, limit - found.Count),
                [next is string ? "cursor" : "page"] = next,
            }, ct);
            var assets = json.GetProperty("assets");
            found.AddRange(assets.GetProperty("items").EnumerateArray().Where(a => !Trashed(a)));
            next = Str(assets, "nextCursor") is { } cursor ? cursor
                : int.TryParse(Str(assets, "nextPage"), out var page) ? page
                : null;
        }
        return found;
    }

    private static bool Trashed(JsonElement asset) => asset.TryGetProperty("isTrashed", out var trashed) && trashed.GetBoolean();

    private static Photo ToPhoto(JsonElement asset) =>
        new(asset.GetProperty("id").GetString()!, TakenAt(asset), Place(asset), Version: Str(asset, "thumbhash"), OwnerId: Str(asset, "ownerId"));

    // The city, or else the state, and the country Immich placed the photo in from its GPS position.
    private static string? Place(JsonElement asset)
    {
        if (!asset.TryGetProperty("exifInfo", out var exif)) return null;
        var place = string.Join(", ", new[] { Str(exif, "city") ?? Str(exif, "state"), Str(exif, "country") }.Where(p => !string.IsNullOrWhiteSpace(p)));
        return place.Length > 0 ? place : null;
    }

    // The focus is the middle of the box around every face, so a group stays together. Immich measures faces in the
    // image it found them in, the preview, which is turned upright like the one a display shows. People are named
    // once, left to right, leaving out the hidden and those without a name.
    public async Task<Faces?> FacesAsync(ImmichAccount account, string photoId, CancellationToken ct)
    {
        if (!Guid.TryParse(photoId, out _)) return null;
        JsonElement faces;
        try
        {
            faces = await SendAsync(account, HttpMethod.Get, $"faces?id={photoId}", null, ct);
        }
        catch (ImmichException e) when (e.InnerException is HttpRequestException { StatusCode: HttpStatusCode.NotFound or HttpStatusCode.BadRequest })
        {
            return null;
        }
        double left = 1, top = 1, right = 0, bottom = 0;
        List<(double X, string Name, string? Born)> people = [];
        foreach (var face in faces.EnumerateArray())
        {
            double width = face.GetProperty("imageWidth").GetDouble(), height = face.GetProperty("imageHeight").GetDouble();
            if (width <= 0 || height <= 0) continue;
            if (face.TryGetProperty("person", out var person) && Str(person, "name") is { Length: > 0 } name
                && !(person.TryGetProperty("isHidden", out var hidden) && hidden.GetBoolean()))
                people.Add((face.GetProperty("boundingBoxX1").GetDouble() / width, name, Str(person, "birthDate") is { Length: >= 10 } born ? born[..10] : null));
            left = Math.Min(left, face.GetProperty("boundingBoxX1").GetDouble() / width);
            top = Math.Min(top, face.GetProperty("boundingBoxY1").GetDouble() / height);
            right = Math.Max(right, face.GetProperty("boundingBoxX2").GetDouble() / width);
            bottom = Math.Max(bottom, face.GetProperty("boundingBoxY2").GetDouble() / height);
        }
        if (right <= left || bottom <= top) return Faces.None;
        var named = people.OrderBy(p => p.X).DistinctBy(p => p.Name).ToList();
        return new Faces(
            new Focus(Math.Round(Math.Clamp((left + right) / 2, 0, 1), 3), Math.Round(Math.Clamp((top + bottom) / 2, 0, 1), 3)),
            named.Select(p => p.Name).ToList(), named.Select(p => p.Born).ToList());
    }

    public async Task<ImmichPhoto?> PhotoAsync(ImmichAccount account, string photoId, CancellationToken ct)
    {
        if (!Guid.TryParse(photoId, out _)) return null;
        var request = Request(account, HttpMethod.Get, $"assets/{photoId}/thumbnail?size=preview&edited=true");
        HttpResponseMessage response;
        try
        {
            response = await Http().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (HttpRequestException e)
        {
            throw Unreachable(account, e);
        }
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.BadRequest)
        {
            response.Dispose();
            return null;
        }
        if (!response.IsSuccessStatusCode)
        {
            response.Dispose();
            throw Refused(response.StatusCode, "fetching a photo", null);
        }
        // Disposing the stream releases the response.
        return new ImmichPhoto(await response.Content.ReadAsStreamAsync(ct), response.Content.Headers.ContentType?.MediaType ?? "image/jpeg");
    }

    // Immich 2.5 and later edit a photo without changing the original: a list of crops, rotations and mirrors, applied in
    // turn. Rotating turns the last of them further when it is a rotation, else adds one; a full turn takes it out, and
    // the edits with it when it was the only one. Immich makes the edited preview in the background, so this waits a
    // while for the thumbhash to change.
    public async Task<RotatedPhoto?> RotateAsync(ImmichAccount account, string photoId, int degrees, CancellationToken ct)
    {
        if (!Guid.TryParse(photoId, out _)) return null;
        if (await AssetAsync(account, photoId, ct) is not { } asset) return null;
        var before = Str(asset, "thumbhash");

        List<JsonElement> current;
        try
        {
            current = [.. (await SendAsync(account, HttpMethod.Get, $"assets/{photoId}/edits", null, ct)).GetProperty("edits").EnumerateArray()];
        }
        catch (ImmichException e) when (e.InnerException is HttpRequestException { StatusCode: HttpStatusCode.NotFound })
        {
            throw new ImmichException("This Immich can't edit photos. Update it to 2.5 or later to rotate photos.", inner: e);
        }
        var angle = degrees;
        if (current is [.., var last] && Str(last, "action") == "rotate")
        {
            angle += last.GetProperty("parameters").GetProperty("angle").GetInt32();
            current.RemoveAt(current.Count - 1);
        }
        angle = (angle % 360 + 360) % 360;
        List<object> edits = [.. current.Select(e => new { action = Str(e, "action"), parameters = e.GetProperty("parameters") })];
        if (angle != 0) edits.Add(new { action = "rotate", parameters = new { angle } });
        if (edits.Count == 0) await SendAsync(account, HttpMethod.Delete, $"assets/{photoId}/edits", null, ct);
        else await SendAsync(account, HttpMethod.Put, $"assets/{photoId}/edits", new { edits }, ct);

        for (var waited = TimeSpan.Zero; waited < PreviewWait; waited += PreviewPoll)
        {
            await Task.Delay(PreviewPoll, _time, ct);
            var now = await AssetAsync(account, photoId, ct) is { } edited ? Str(edited, "thumbhash") : null;
            if (now != before) return new(now);
        }
        return new(before);
    }

    public async Task FavoriteAsync(ImmichAccount account, string photoId, bool favorite, CancellationToken ct)
    {
        if (!Guid.TryParse(photoId, out _)) throw new ImmichException("That is not a photo in Immich.");
        await SendAsync(account, HttpMethod.Put, $"assets/{photoId}", new { isFavorite = favorite }, ct);
    }

    // Null when the asset is gone.
    private async Task<JsonElement?> AssetAsync(ImmichAccount account, string photoId, CancellationToken ct)
    {
        try
        {
            return await SendAsync(account, HttpMethod.Get, $"assets/{photoId}", null, ct);
        }
        catch (ImmichException e) when (e.InnerException is HttpRequestException { StatusCode: HttpStatusCode.NotFound or HttpStatusCode.BadRequest })
        {
            return null;
        }
    }

    private static HttpRequestMessage Request(ImmichAccount account, HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, $"{account.Address.TrimEnd('/')}/api/{path}");
        request.Headers.Add("x-api-key", account.ApiKey);
        request.Headers.Accept.ParseAdd("application/json");
        return request;
    }

    private async Task<JsonElement> SendAsync(ImmichAccount account, HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var request = Request(account, method, path);
        if (body is not null) request.Content = JsonContent.Create(body);
        HttpResponseMessage response;
        try
        {
            response = await Http().SendAsync(request, ct);
        }
        catch (HttpRequestException e)
        {
            throw Unreachable(account, e);
        }
        using (response)
        {
            var text = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode) throw Refused(response.StatusCode, $"{method} {path}", text);
            // Such as a deletion's 204.
            if (text.Length == 0) return default;
            try
            {
                return JsonSerializer.Deserialize<JsonElement>(text);
            }
            catch (JsonException e)
            {
                throw new ImmichException($"{account.Address} does not answer like Immich. Check the address under Accounts.", inner: e);
            }
        }
    }

    private static ImmichException Unreachable(ImmichAccount account, HttpRequestException e) =>
        new($"Could not reach Immich at {account.Address}. Check that it is running and the address under Accounts.", inner: e);

    // Unauthorized: the key is wrong or revoked. Forbidden: the key lacks a permission. Bad request, to an edit: Immich
    // can't edit that photo, such as a live photo, and says why.
    private static ImmichException Refused(HttpStatusCode status, string what, string? text) => status switch
    {
        HttpStatusCode.Unauthorized => new("Immich does not accept the API key. Make a new one in Immich and enter it under Accounts.", keyRefused: true),
        HttpStatusCode.Forbidden when what.EndsWith("users/me", StringComparison.Ordinal) =>
            new("The API key may not say whose it is. Give it the user.read permission in Immich.", keyRefused: true),
        HttpStatusCode.Forbidden when what.Contains(" partners", StringComparison.Ordinal) =>
            new("The API key may not see who shares photos with it. Give it the partner.read permission in Immich.", keyRefused: true),
        HttpStatusCode.Forbidden when what.EndsWith("/edits", StringComparison.Ordinal) =>
            new("The API key may not edit photos. Give it the asset.edit.get, asset.edit.create and asset.edit.delete permissions in Immich.", keyRefused: true),
        HttpStatusCode.BadRequest when what.EndsWith("/edits", StringComparison.Ordinal) && Message(text) is { } message =>
            new($"Immich can't rotate this photo: {message}.", inner: new HttpRequestException(null, null, status)),
        HttpStatusCode.Forbidden when what.StartsWith("PUT assets/", StringComparison.Ordinal) =>
            new("The API key may not change photos. Give it the asset.update permission in Immich.", keyRefused: true),
        HttpStatusCode.BadRequest or HttpStatusCode.NotFound when what.StartsWith("PUT assets/", StringComparison.Ordinal) =>
            new("Immich won't let this account favorite the photo."),
        HttpStatusCode.Forbidden => new("The API key may not read albums, people, faces and photos. Give it the album.read, asset.read, asset.view, face.read and person.read permissions in Immich.", keyRefused: true),
        _ => new($"Immich answered {(int)status} to {what}" + (string.IsNullOrWhiteSpace(text) ? "." : $": {text}"),
            inner: new HttpRequestException(null, null, status)),
    };

    // What Immich says went wrong, in its error's message.
    private static string? Message(string? text)
    {
        try
        {
            return text is null ? null : Str(JsonSerializer.Deserialize<JsonElement>(text), "message")?.TrimEnd('.');
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // Immich's fileCreatedAt is when the photo was taken, from its metadata where it has any.
    private static DateTimeOffset? TakenAt(JsonElement asset) =>
        Str(asset, "fileCreatedAt") is { } taken && DateTimeOffset.TryParse(taken, out var at) ? at : null;

    private static string? Str(JsonElement json, string name) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
