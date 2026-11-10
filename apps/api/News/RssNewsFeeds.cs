using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace HomeyDash.Api.News;

/// <summary>Reads a source's RSS 2.0 or Atom feed (ADR-0016): no key, and the newest stories first.</summary>
public sealed partial class RssNewsFeeds(IHttpClientFactory httpFactory) : INewsFeeds
{
    public const string HttpClientName = "News";

    // Enough for the biggest tile.
    public const int MaxItems = 12;

    public static void ConfigureHttpClient(HttpClient http)
    {
        http.Timeout = TimeSpan.FromSeconds(15);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("HomeyDash");
    }

    public async Task<IReadOnlyList<NewsItem>> ReadAsync(NewsSource source, CancellationToken ct)
    {
        string xml;
        try
        {
            var response = await httpFactory.CreateClient(HttpClientName).GetAsync(source.Url, ct);
            if (!response.IsSuccessStatusCode) throw new NewsException($"{source.Name} answered {(int)response.StatusCode}.");
            xml = await response.Content.ReadAsStringAsync(ct);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            throw new NewsException($"Cannot reach {source.Name}.", e);
        }
        return Parse(xml, source.Name);
    }

    public static IReadOnlyList<NewsItem> Parse(string xml, string name)
    {
        XDocument document;
        try
        {
            document = XDocument.Parse(xml);
        }
        catch (System.Xml.XmlException e)
        {
            throw new NewsException($"{name} did not answer with a news feed.", e);
        }
        // RSS has <item>s, Atom <entry>s; namespaces don't matter for either.
        var entries = document.Descendants().Where(e => e.Name.LocalName is "item" or "entry");
        var items = entries.Select(Item).OfType<NewsItem>()
            .OrderByDescending(i => i.PublishedAt ?? DateTimeOffset.MinValue)
            .Take(MaxItems)
            .ToList();
        if (items.Count == 0) throw new NewsException($"{name} has no stories.");
        return items;
    }

    private static NewsItem? Item(XElement entry)
    {
        string? Text(string local) => entry.Elements().FirstOrDefault(e => e.Name.LocalName == local)?.Value is { } v ? Clean(v) : null;

        var title = Text("title");
        if (string.IsNullOrEmpty(title)) return null;
        var summary = Text("description") ?? Text("summary");
        // Atom's link is an attribute, RSS's the text.
        var link = entry.Elements().FirstOrDefault(e => e.Name.LocalName == "link") is { } l ? (l.Attribute("href")?.Value ?? l.Value).Trim() : null;
        var date = Text("pubDate") ?? Text("published") ?? Text("updated");
        var image = entry.Elements().Where(e => e.Name.LocalName is "enclosure" or "thumbnail" or "content")
            .Where(e => e.Attribute("type") is not { } t || t.Value.StartsWith("image/", StringComparison.Ordinal))
            .Select(e => e.Attribute("url")?.Value)
            .FirstOrDefault(u => u is not null && u.StartsWith("http", StringComparison.Ordinal));
        return new NewsItem(title, string.IsNullOrEmpty(summary) || summary == title ? null : summary, link, image, Date(date));
    }

    private static DateTimeOffset? Date(string? text) =>
        text is not null && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date) ? date : null;

    // Feeds put markup and entities in their text: leave the words.
    private static string Clean(string text) => Spaces().Replace(WebUtility.HtmlDecode(Tags().Replace(text, " ")), " ").Trim();

    [GeneratedRegex("<[^>]*>")]
    private static partial Regex Tags();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
