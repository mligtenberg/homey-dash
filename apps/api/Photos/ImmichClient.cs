using System.Net;
using System.Text.Json;

namespace HomeyDash.Api.Photos;

/// <summary>
/// Immich over its REST API, with the account's API key in the x-api-key header. An album's photos come from
/// /search/metadata, since Immich 3 no longer lists them with the album. A selection draws from /search/smart when it
/// has a query, else from each wanted person's photos, else from /search/random, and leaves out unwanted people's photos.
/// </summary>
public sealed class ImmichClient(IHttpClientFactory httpFactory, Random? random = null) : IImmich
{
    public const string HttpClientName = "Immich";

    // Immich's largest page.
    private const int PageSize = 1000;

    // At most this many of someone's photos to draw from, or to leave out.
    private const int PersonLimit = 20_000;

    private readonly Random _random = random ?? Random.Shared;

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
        foreach (var asset in await SearchAsync(account, "search/metadata", new() { ["albumIds"] = new[] { albumId } }, int.MaxValue, ct))
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

    public async Task<IReadOnlyList<Photo>> SelectAsync(ImmichAccount account, PhotoSelection selection, CancellationToken ct)
    {
        // A smart search ranks everything by how well it matches, so only the best twice as many as needed count.
        var smartLimit = Math.Min(selection.Count * 2, PageSize);
        IEnumerable<string?> wanted = selection.With.Count == 0 ? [null] : selection.With.Select(p => p.Id);
        Dictionary<string, Photo> pool = [];
        foreach (var person in wanted)
        {
            Dictionary<string, object> filter = new() { ["type"] = "IMAGE" };
            if (person is not null) filter["personIds"] = new[] { person };
            IEnumerable<JsonElement> found = selection.Query is { } query
                ? await SearchAsync(account, "search/smart", new(filter) { ["query"] = query }, smartLimit, ct)
                : person is not null
                    ? await SearchAsync(account, "search/metadata", filter, PersonLimit, ct)
                    : (await SendAsync(account, HttpMethod.Post, "search/random", new Dictionary<string, object>(filter) { ["size"] = PageSize }, ct))
                        .EnumerateArray().ToList();
            foreach (var asset in found.Where(a => a.GetProperty("type").GetString() == "IMAGE" && !Trashed(a)))
                pool.TryAdd(asset.GetProperty("id").GetString()!, ToPhoto(asset));
        }
        foreach (var person in selection.Without)
            foreach (var asset in await SearchAsync(account, "search/metadata", new() { ["personIds"] = new[] { person.Id } }, PersonLimit, ct))
                pool.Remove(asset.GetProperty("id").GetString()!);

        var photos = pool.Values.ToArray();
        _random.Shuffle(photos);
        return photos.Take(selection.Count).ToList();
    }

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

    private static Photo ToPhoto(JsonElement asset) => new(asset.GetProperty("id").GetString()!, TakenAt(asset));

    public async Task<ImmichPhoto?> PhotoAsync(ImmichAccount account, string photoId, CancellationToken ct)
    {
        if (!Guid.TryParse(photoId, out _)) return null;
        var request = Request(account, HttpMethod.Get, $"assets/{photoId}/thumbnail?size=preview");
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

    // Unauthorized: the key is wrong or revoked. Forbidden: the key lacks a permission.
    private static ImmichException Refused(HttpStatusCode status, string what, string? text) => status switch
    {
        HttpStatusCode.Unauthorized => new("Immich does not accept the API key. Make a new one in Immich and enter it under Accounts.", keyRefused: true),
        HttpStatusCode.Forbidden => new("The API key may not read albums, people and photos. Give it the album.read, asset.read, asset.view and person.read permissions in Immich.", keyRefused: true),
        _ => new($"Immich answered {(int)status} to {what}" + (string.IsNullOrWhiteSpace(text) ? "." : $": {text}"),
            inner: new HttpRequestException(null, null, status)),
    };

    // Immich's fileCreatedAt is when the photo was taken, from its metadata where it has any.
    private static DateTimeOffset? TakenAt(JsonElement asset) =>
        Str(asset, "fileCreatedAt") is { } taken && DateTimeOffset.TryParse(taken, out var at) ? at : null;

    private static string? Str(JsonElement json, string name) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
