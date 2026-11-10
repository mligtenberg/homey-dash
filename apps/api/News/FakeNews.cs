namespace HomeyDash.Api.News;

/// <summary>Always the same handful of stories, the newest just now; for development and tests (News:Fake).</summary>
public sealed class FakeNews(TimeProvider time) : INewsFeeds
{
    private static readonly (string Title, string Summary)[] Stories =
    [
        ("Cabinet agrees on new rules for home batteries", "Households with solar panels may feed back less, but pay less for storage."),
        ("Heavy rain expected across the north tonight", "KNMI has issued a code yellow for several provinces."),
        ("Train service between Utrecht and Amsterdam disrupted", "A signal failure stops trains for at least an hour."),
        ("Ajax wins at home after a late goal", "A header in the 89th minute decided a tense match."),
        ("New exhibition opens at the Rijksmuseum", "Forty paintings from private collections are on show for the first time."),
        ("Mild week ahead, with sunshine on Thursday", "Temperatures stay around ten degrees."),
    ];

    public Task<IReadOnlyList<NewsItem>> ReadAsync(NewsSource source, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        IReadOnlyList<NewsItem> items = Stories
            .Select((s, i) => new NewsItem(s.Title, s.Summary, "https://example.com/" + source.Id + "/" + i, null, now.AddMinutes(-7 - 23 * i)))
            .ToList();
        return Task.FromResult(items);
    }
}
