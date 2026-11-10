using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace HomeyDash.Api.News;

/// <summary>A NOS livestream, on now or coming: Url plays it (HLS), Live says whether it is on now.</summary>
public sealed record NewsLive(string Id, string Title, string? Description, DateTimeOffset? StartAt, DateTimeOffset? EndAt, string? Image, string Url, bool Live);

/// <summary>A video NOS published: Seconds is how long it runs; its stream comes from <see cref="INosVideos.StreamAsync"/>.</summary>
public sealed record NewsVideo(string Id, string Title, string? Description, int? Seconds, string? Image, DateTimeOffset? PublishedAt, string? Category);

/// <summary>Where NOS's livestreams and videos come from: its own pages, or the fake (ADR-0016).</summary>
public interface INosVideos
{
    /// <summary>The livestreams on now, then those coming, soonest first.</summary>
    Task<IReadOnlyList<NewsLive>> LiveAsync(CancellationToken ct);

    /// <summary>The newest videos, newest first.</summary>
    Task<IReadOnlyList<NewsVideo>> VideosAsync(CancellationToken ct);

    /// <summary>The HLS stream of a video, by its NOS id.</summary>
    Task<string> StreamAsync(string id, CancellationToken ct);
}

/// <summary>
/// Reads NOS's live page (<c>nos.nl/live</c>), video list (<c>nos.nl/nieuws/laatste/videos</c>) and video pages from the data
/// the pages carry. Streams are HLS the screen plays itself; HomeyDash only tells it where.
/// </summary>
public sealed class NosVideos(IHttpClientFactory httpFactory, IMemoryCache cache, TimeProvider time) : INosVideos
{
    private const string Home = "https://nos.nl";

    public Task<IReadOnlyList<NewsLive>> LiveAsync(CancellationToken ct) =>
        Cached("live", TimeSpan.FromSeconds(60), async () =>
        {
            var page = await PageAsync($"{Home}/live", ct);
            var now = time.GetUtcNow();
            var items = new List<NewsLive>();
            foreach (var (name, live) in new[] { ("liveLivestreams", true), ("upcomingLivestreams", false) })
            {
                if (!page.TryGetProperty(name, out var list) || list.ValueKind != JsonValueKind.Array) continue;
                foreach (var stream in list.EnumerateArray())
                {
                    if (Str(stream, "isOnline") == "false" || Stream(stream) is not { } url || Str(stream, "title") is not { Length: > 0 } title) continue;
                    var start = Date(Str(stream, "startAt"));
                    var end = Date(Str(stream, "endAt"));
                    items.Add(new(Str(stream, "id") ?? title, title, NosArticles.Plain(Str(stream, "description")), start, end, Image(stream, "indexImage"), url, live || (start <= now && (end is null || end > now))));
                }
            }
            return (IReadOnlyList<NewsLive>)items.OrderByDescending(i => i.Live).ThenBy(i => i.StartAt ?? DateTimeOffset.MaxValue).ToList();
        });

    public Task<IReadOnlyList<NewsVideo>> VideosAsync(CancellationToken ct) =>
        Cached("videos", TimeSpan.FromMinutes(5), async () =>
        {
            var page = await PageAsync($"{Home}/nieuws/laatste/videos", ct);
            var items = new List<NewsVideo>();
            if (page.TryGetProperty("items", out var list) && list.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in list.EnumerateArray().Take(36))
                {
                    if (Str(item, "id") is not { Length: > 0 } id || !id.All(char.IsAsciiDigit) || Str(item, "title") is not { Length: > 0 } title) continue;
                    var category = item.TryGetProperty("categories", out var cats) && cats.ValueKind == JsonValueKind.Array && cats.GetArrayLength() > 0 ? Str(cats[0], "label") : null;
                    items.Add(new(id, NosArticles.Plain(title)!, NosArticles.Plain(Str(item, "description")), int.TryParse(Str(item, "duration"), out var s) ? s : null,
                        Image(item, "image"), Date(Str(item, "publishedAt")), category));
                }
            }
            return (IReadOnlyList<NewsVideo>)items;
        });

    public Task<string> StreamAsync(string id, CancellationToken ct)
    {
        if (id.Length == 0 || !id.All(char.IsAsciiDigit)) throw new NewsException("That is not a NOS video.");
        return Cached("video:" + id, TimeSpan.FromMinutes(30), async () =>
        {
            var page = await PageAsync($"{Home}/video/{id}", ct);
            var source = page.TryGetProperty("data", out var data) && data.TryGetProperty("video", out var video) && video.TryGetProperty("source", out var s) ? s : default;
            return Str(source, "url") is { } url && Playable(url) ? url : throw new NewsException("NOS has no stream for that video.");
        });
    }

    // Only NOS's stream resolver is ever handed to a screen.
    public static bool Playable(string? url) => Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && uri.Host == "resolver.streaming.api.nos.nl";

    // The HLS stream among a livestream's formats.
    private static string? Stream(JsonElement stream) =>
        stream.TryGetProperty("formats", out var formats) && formats.ValueKind == JsonValueKind.Array
            ? formats.EnumerateArray().Where(f => Str(f, "mimetype") == "application/vnd.apple.mpegurl").Select(f => Str(f, "url")).FirstOrDefault(Playable)
            : null;

    private async Task<JsonElement> PageAsync(string url, CancellationToken ct)
    {
        try
        {
            var response = await httpFactory.CreateClient(RssNewsFeeds.HttpClientName).GetAsync(url, ct);
            if (!response.IsSuccessStatusCode) throw new NewsException($"NOS answered {(int)response.StatusCode}.");
            var html = await response.Content.ReadAsStringAsync(ct);
            return NosArticles.PageProps(html) ?? throw new NewsException("NOS did not give the page in a form HomeyDash can read.");
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            throw new NewsException("Cannot reach NOS.", e);
        }
    }

    private async Task<T> Cached<T>(string key, TimeSpan keep, Func<Task<T>> read)
    {
        if (cache.TryGetValue(key, out T? known) && known is not null) return known;
        var value = await read();
        cache.Set(key, value, keep);
        return value;
    }

    private static string? Str(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value)
            ? value.ValueKind switch { JsonValueKind.String => value.GetString(), JsonValueKind.True => "true", JsonValueKind.False => "false", JsonValueKind.Number => value.GetRawText(), _ => null }
            : null;

    private static DateTimeOffset? Date(string? text) => DateTimeOffset.TryParse(text, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d) ? d : null;

    // A picture of about 640 wide: from `Ratio16x9` (livestreams) or `imagesByRatio` (videos).
    private static string? Image(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var image) || image.ValueKind != JsonValueKind.Object) return null;
        JsonElement crops = default;
        if (image.TryGetProperty("Ratio16x9", out var a) && a.ValueKind == JsonValueKind.Array) crops = a;
        else if (image.TryGetProperty("imagesByRatio", out var b) && b.TryGetProperty("16:9", out var c) && c.ValueKind == JsonValueKind.Array) crops = c;
        if (crops.ValueKind != JsonValueKind.Array) return null;
        string? best = null;
        foreach (var crop in crops.EnumerateArray())
        {
            var url = Str(crop, "url");
            if (url is null || !url.StartsWith("https://images.cdn.nos.nl/", StringComparison.Ordinal)) continue;
            if (best is null || (crop.TryGetProperty("width", out var w) && w.TryGetInt32(out var width) && width <= 640)) best = url;
        }
        return best;
    }
}

/// <summary>A few made-up livestreams and videos, playing a public test stream; for development and tests (News:Fake).</summary>
public sealed class FakeNosVideos(TimeProvider time) : INosVideos
{
    public const string TestStream = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

    public Task<IReadOnlyList<NewsLive>> LiveAsync(CancellationToken ct)
    {
        var now = time.GetUtcNow();
        IReadOnlyList<NewsLive> items =
        [
            new("l1", "Tweede Kamer debatteert over het Belastingplan", "Het debat is live te volgen.", now.AddMinutes(-30), now.AddHours(3), null, TestStream, true),
            new("l2", "NOS Journaal van 20 uur", "De hele uitzending, met momenten.", now.AddHours(4), now.AddHours(5), null, TestStream, false),
        ];
        return Task.FromResult(items);
    }

    public Task<IReadOnlyList<NewsVideo>> VideosAsync(CancellationToken ct)
    {
        var now = time.GetUtcNow();
        IReadOnlyList<NewsVideo> items =
        [
            new("1", "Dierentuin voorbereid op noodsituatie", "Half jaar vlees voor de leeuwen op voorraad.", 110, null, now.AddMinutes(-12), "Buitenland"),
            new("2", "Ajax wint na laat doelpunt", "Een kopbal in de 89e minuut.", 75, null, now.AddMinutes(-80), "Sport"),
            new("3", "Regen in het noorden", null, 48, null, now.AddHours(-3), "Binnenland"),
        ];
        return Task.FromResult(items);
    }

    public Task<string> StreamAsync(string id, CancellationToken ct) => Task.FromResult(TestStream);
}
