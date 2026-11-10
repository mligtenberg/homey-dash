namespace HomeyDash.Api.News;

/// <summary>Always the same handful of stories, the newest just now; for development and tests (News:Fake).</summary>
public sealed class FakeNews(TimeProvider time) : INewsFeeds
{
    private static readonly (string Title, string Summary)[] Stories =
    [
        ("Kabinet stemt in met nieuwe regels voor thuisbatterijen", "Huishoudens met zonnepanelen mogen minder terugleveren, maar betalen minder voor opslag."),
        ("Vanavond veel regen verwacht in het noorden", "Het KNMI heeft code geel afgegeven voor meerdere provincies."),
        ("Treinverkeer tussen Utrecht en Amsterdam verstoord", "Door een seinstoring rijden er minstens een uur geen treinen."),
        ("Ajax wint thuis na een laat doelpunt", "Een kopbal in de 89e minuut besliste een spannende wedstrijd."),
        ("Nieuwe tentoonstelling geopend in het Rijksmuseum", "Veertig schilderijen uit privécollecties zijn voor het eerst te zien."),
        ("Zachte week voor de boeg, met zon op donderdag", "De temperatuur blijft rond de tien graden."),
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
