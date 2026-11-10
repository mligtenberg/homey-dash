using System.Text.Json;

namespace HomeyDash.Api.News;

// The News section of the configuration.
public sealed class NewsOptions
{
    // Runs against FakeNews instead of the real feeds, for development and tests. Never a fallback.
    public bool Fake { get; set; }
}

/// <summary>
/// A news feed a news tile or lock screen widget can show (ADR-0016). A fixed list, so HomeyDash only ever fetches feeds it
/// knows; the first is what a tile or widget that names none shows.
/// </summary>
public sealed record NewsSource(string Id, string Name, string Url)
{
    public static readonly IReadOnlyList<NewsSource> All =
    [
        new("nos", "NOS Nieuws", "https://feeds.nos.nl/nosnieuwsalgemeen"),
        new("nos-politiek", "NOS Politiek", "https://feeds.nos.nl/nosnieuwspolitiek"),
        new("nos-binnenland", "NOS Binnenland", "https://feeds.nos.nl/nosnieuwsbinnenland"),
        new("nos-buitenland", "NOS Buitenland", "https://feeds.nos.nl/nosnieuwsbuitenland"),
        new("nos-economie", "NOS Economie", "https://feeds.nos.nl/nosnieuwseconomie"),
        new("nos-koningshuis", "NOS Koningshuis", "https://feeds.nos.nl/nosnieuwskoningshuis"),
        new("nos-cultuur", "NOS Cultuur & media", "https://feeds.nos.nl/nosnieuwscultuurenmedia"),
        new("nos-opmerkelijk", "NOS Opmerkelijk", "https://feeds.nos.nl/nosnieuwsopmerkelijk"),
        new("nos-sport", "NOS Sport", "https://feeds.nos.nl/nossportalgemeen"),
        new("nos-tech", "NOS Tech", "https://feeds.nos.nl/nosnieuwstech"),
    ];

    public static NewsSource Default => All[0];

    public static NewsSource? Find(string? id) => id is null ? Default : All.FirstOrDefault(s => s.Id == id);

    // The source of a news tile's settings (<c>settings.source</c>); the default when it names none, null when it names an unknown one.
    public static NewsSource? Of(JsonElement settings) =>
        settings.ValueKind == JsonValueKind.Object && settings.TryGetProperty("source", out var source) && source.ValueKind == JsonValueKind.String
            ? Find(source.GetString())
            : Default;
}

// One story: its headline, a line of summary, where to read it, a picture and when it came out.
public sealed record NewsItem(string Title, string? Summary, string? Link, string? Image, DateTimeOffset? PublishedAt);

/// <summary>
/// The latest stories of one source. Status is <c>loading</c> until HomeyDash knows, <c>connected</c>, or <c>disconnected</c>
/// when the feed can't be reached (Error says why; the last stories stay). Pushed to every connection as <c>News</c>.
/// </summary>
public sealed record NewsFeed(string Source, string Name, string Status, string? Error, IReadOnlyList<NewsItem> Items, DateTimeOffset? UpdatedAt);

// A feed that couldn't be read; Message says so for people.
public sealed class NewsException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Where the news comes from: the sources' RSS feeds, or the fake.</summary>
public interface INewsFeeds
{
    Task<IReadOnlyList<NewsItem>> ReadAsync(NewsSource source, CancellationToken ct);
}
