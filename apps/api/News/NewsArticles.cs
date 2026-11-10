using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace HomeyDash.Api.News;

/// <summary>One part of an article: a paragraph (<c>p</c>), subheading (<c>h</c>), quote (<c>quote</c>, Source says by whom) or picture (<c>image</c>, Text is its caption, Source its credit and Url the file).</summary>
public sealed record ArticleBlock(string Kind, string Text, string? Source = null, string? Url = null);

/// <summary>A story's full text, read from its page (ADR-0016). Text is HTML limited to emphasis; everything is already escaped.</summary>
public sealed record NewsArticle(string Title, string? Intro, string? Image, string? ImageCredit, IReadOnlyList<ArticleBlock> Blocks);

/// <summary>Where the full text of a story comes from: its page on nos.nl, or the fake.</summary>
public interface INewsArticles
{
    Task<NewsArticle> ReadAsync(string link, CancellationToken ct);
}

/// <summary>
/// Reads a story from nos.nl. The site refuses to be shown inside another page (<c>frame-ancestors 'self'</c>), so HomeyDash
/// reads the article out of the page's own data and shows it as a reader view of its own, which a screen can frame.
/// </summary>
public sealed partial class NosArticles(IHttpClientFactory httpFactory, IMemoryCache cache) : INewsArticles
{
    private static readonly TimeSpan Keep = TimeSpan.FromMinutes(30);

    public async Task<NewsArticle> ReadAsync(string link, CancellationToken ct)
    {
        if (!IsNos(link)) throw new NewsException("That story is not on nos.nl.");
        if (cache.TryGetValue(link, out NewsArticle? known) && known is not null) return known;

        string html;
        try
        {
            var response = await httpFactory.CreateClient(RssNewsFeeds.HttpClientName).GetAsync(link, ct);
            if (!response.IsSuccessStatusCode) throw new NewsException($"NOS answered {(int)response.StatusCode}.");
            if (!IsNos(response.RequestMessage?.RequestUri?.ToString())) throw new NewsException("That story moved away from nos.nl.");
            html = await response.Content.ReadAsStringAsync(ct);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            throw new NewsException("Cannot reach NOS.", e);
        }

        var article = Parse(html);
        cache.Set(link, article, Keep);
        return article;
    }

    // An article on nos.nl: its own address (`/artikel/…`, `/sport/artikel/…`) or the short link the feeds give (`/l/2638863`), which NOS sends on to it.
    public static bool IsArticle(string? link)
    {
        if (!IsNos(link)) return false;
        var path = new Uri(link!).AbsolutePath;
        return path.StartsWith("/artikel/", StringComparison.Ordinal) || path.Contains("/artikel/", StringComparison.Ordinal)
            || (path.StartsWith("/l/", StringComparison.Ordinal) && path.Length > 3 && path[3..].All(char.IsAsciiDigit));
    }

    // Only NOS's own pages are ever fetched, whatever a link says.
    public static bool IsNos(string? link) =>
        Uri.TryCreate(link, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && (uri.Host == "nos.nl" || uri.Host.EndsWith(".nos.nl", StringComparison.Ordinal));

    // The page's own data, the `pageProps` of its `__NEXT_DATA__`; null when the page has none.
    internal static JsonElement? PageProps(string html)
    {
        var data = NextData().Match(html);
        if (!data.Success) return null;
        try
        {
            using var document = JsonDocument.Parse(data.Groups[1].Value);
            return document.RootElement.TryGetProperty("props", out var props) && props.TryGetProperty("pageProps", out var page) ? page.Clone() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static NewsArticle Parse(string html)
    {
        var data = NextData().Match(html);
        if (!data.Success) throw new NewsException("NOS did not give the story in a form HomeyDash can read.");
        JsonElement article;
        try
        {
            using var document = JsonDocument.Parse(data.Groups[1].Value);
            if (!document.RootElement.TryGetProperty("props", out var props) || !props.TryGetProperty("pageProps", out var page) || !page.TryGetProperty("article", out article)
                || article.ValueKind != JsonValueKind.Object)
                throw new NewsException("NOS did not give the story in a form HomeyDash can read.");
            article = article.Clone();
        }
        catch (JsonException e)
        {
            throw new NewsException("NOS did not give the story in a form HomeyDash can read.", e);
        }

        var title = Str(article, "title");
        if (string.IsNullOrEmpty(title)) throw new NewsException("NOS did not give the story in a form HomeyDash can read.");

        var blocks = new List<ArticleBlock>();
        if (article.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in content.EnumerateArray())
            {
                switch (Str(element, "__typename"))
                {
                    case "TextElement" when Inline(Str(element, "text")) is { Length: > 0 } text:
                        blocks.Add(new("p", text));
                        break;
                    case "HeaderElement" when Plain(Str(element, "text")) is { Length: > 0 } heading:
                        blocks.Add(new("h", heading));
                        break;
                    case "QuoteElement" when Inline(Str(element, "text")) is { Length: > 0 } quote:
                        blocks.Add(new("quote", quote, Plain(Str(element, "source"))));
                        break;
                    case "ImageElement" when ImageUrl(Child(element, "imageAsset")) is { } url:
                        blocks.Add(new("image", Plain(Str(element, "imageDescription")) ?? "", Plain(Str(Child(element, "imageAsset"), "copyright")), url));
                        break;
                }
            }
        }

        var header = Child(Child(article, "headerImage"), "imageAsset");
        return new NewsArticle(
            Plain(title)!,
            Plain(Str(article, "description")),
            ImageUrl(header),
            Plain(Str(header, "copyright")),
            blocks);
    }

    // The largest picture that is still a sensible size, from an asset's 16:9 crops (smallest first).
    private static string? ImageUrl(JsonElement asset)
    {
        if (asset.ValueKind != JsonValueKind.Object || !asset.TryGetProperty("Ratio16x9", out var crops) || crops.ValueKind != JsonValueKind.Array) return null;
        string? best = null;
        foreach (var crop in crops.EnumerateArray())
        {
            var url = Str(crop, "url");
            if (url is null || !url.StartsWith("https://images.cdn.nos.nl/", StringComparison.Ordinal)) continue;
            if (best is null || (crop.TryGetProperty("width", out var width) && width.TryGetInt32(out var w) && w <= 1024)) best = url;
        }
        return best;
    }

    // A property that is an object, or nothing: NOS sends null for what an article does not have, such as a header picture.
    private static JsonElement Child(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object ? value : default;

    private static string? Str(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    // Text without markup, as text.
    internal static string? Plain(string? text) => text is null ? null : Spaces().Replace(WebUtility.HtmlDecode(Tags().Replace(text, " ")), " ").Trim();

    // Text with its emphasis kept and all else escaped, so it can go into a page as is.
    internal static string Inline(string? text)
    {
        if (text is null) return "";
        var result = new StringBuilder();
        foreach (Match part in Token().Matches(text))
        {
            if (part.Value[0] != '<')
            {
                result.Append(WebUtility.HtmlEncode(WebUtility.HtmlDecode(part.Value)));
                continue;
            }
            var tag = EmphasisTag().Match(part.Value);
            if (tag.Success) result.Append('<').Append(tag.Groups[1].Value).Append(tag.Groups[2].Value.ToLowerInvariant()).Append('>');
        }
        return result.ToString().Trim();
    }

    [GeneratedRegex("""<script id="__NEXT_DATA__"[^>]*>(.*?)</script>""", RegexOptions.Singleline)]
    private static partial Regex NextData();

    [GeneratedRegex("<[^>]*>")]
    private static partial Regex Tags();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();

    [GeneratedRegex("<[^>]*>|[^<]+")]
    private static partial Regex Token();

    [GeneratedRegex("^<(/?)(em|strong|i|b)(?:\\s[^>]*)?>$", RegexOptions.IgnoreCase)]
    private static partial Regex EmphasisTag();
}

/// <summary>A made-up article for every story; for development and tests (News:Fake).</summary>
public sealed class FakeArticles : INewsArticles
{
    public Task<NewsArticle> ReadAsync(string link, CancellationToken ct) => Task.FromResult(new NewsArticle(
        "Kabinet stemt in met nieuwe regels voor thuisbatterijen",
        "Huishoudens met zonnepanelen mogen minder terugleveren, maar betalen minder voor opslag.",
        null,
        null,
        [
            new("p", "Het kabinet heeft <em>vrijdag</em> ingestemd met nieuwe regels voor thuisbatterijen. Huishoudens met zonnepanelen kunnen straks hun overschot opslaan in plaats van terugleveren."),
            new("p", "Volgens minister Hermans moet het net daardoor 's avonds minder zwaar belast worden. De regels gaan volgend jaar in."),
            new("h", "Wat verandert er?"),
            new("p", "Wie een batterij installeert, betaalt minder netwerkkosten. Wie dat niet doet, merkt er niets van. De <strong>salderingsregeling</strong> stopt in 2027."),
            new("quote", "Dit maakt opslag voor gewone huishoudens eindelijk aantrekkelijk.", "Energie-Nederland"),
            new("p", "Netbeheerders waarschuwden eerder dat het net in sommige wijken tegen de grens aan zit. Een batterij in huis kan die drukte spreiden."),
        ]));
}
