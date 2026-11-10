using System.Net;
using System.Text;

namespace HomeyDash.Api.News;

/// <summary>The reader view of a story (ADR-0016): a page a news tile's detail view frames, with the story's own text and pictures.</summary>
public static class ArticlePage
{
    // NOS's own colours: white and near-black, the NOS red. What the page may load: its own style and one inline script, and NOS's pictures. The text is escaped, and the frame is sandboxed without an origin. Only HomeyDash may frame it.
    public const string Policy = "default-src 'none'; img-src https://images.cdn.nos.nl; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'";

    public static string Render(NewsArticle article, string sourceName, DateTimeOffset? publishedAt, bool dark)
    {
        var page = new StringBuilder();
        page.Append("<!doctype html><html lang=\"nl\" data-theme=\"").Append(dark ? "dark" : "light").Append("\"><head><meta charset=\"utf-8\">")
            .Append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>").Append(WebUtility.HtmlEncode(article.Title)).Append("</title><style>")
            .Append(Style).Append("</style></head><body><article>");
        page.Append("<p class=\"meta\">").Append(Logo).Append(WebUtility.HtmlEncode(sourceName.StartsWith("NOS ", StringComparison.Ordinal) ? sourceName[4..] : sourceName));
        if (publishedAt is { } at) page.Append(" · <time datetime=\"").Append(at.ToString("o")).Append("\">").Append(WebUtility.HtmlEncode(Dutch(at))).Append("</time>");
        page.Append("</p><h1>").Append(WebUtility.HtmlEncode(article.Title)).Append("</h1>");
        if (article.Intro is { Length: > 0 } intro) page.Append("<p class=\"intro\">").Append(WebUtility.HtmlEncode(intro)).Append("</p>");
        if (article.Image is { } image) Figure(page, image, "", article.ImageCredit);
        foreach (var block in article.Blocks)
        {
            switch (block.Kind)
            {
                case "p": page.Append("<p>").Append(block.Text).Append("</p>"); break;
                case "h": page.Append("<h2>").Append(WebUtility.HtmlEncode(block.Text)).Append("</h2>"); break;
                case "quote":
                    page.Append("<blockquote><p>").Append(block.Text).Append("</p>");
                    if (block.Source is { Length: > 0 } who) page.Append("<footer>").Append(WebUtility.HtmlEncode(who)).Append("</footer>");
                    page.Append("</blockquote>");
                    break;
                case "image" when block.Url is { } url: Figure(page, url, block.Text, block.Source); break;
            }
        }
        return page.Append("</article><script>").Append(Script).Append("</script></body></html>").ToString();
    }

    // The NOS wordmark: letters warm grey (white on dark), the O in NOS red.
    private const string Logo = "<svg class=\"logo\" viewBox=\"0 0 114 41\" role=\"img\" aria-label=\"NOS\"><path fill=\"currentColor\" d=\"M24.243.995v21.71L9.418.995H0v38.777h10.348V18.067l14.767 21.705h9.476V.995zM103.108 28.68q0-.926-.492-1.621t-1.739-1.303q-1.246-.607-3.504-1.245l-2.607-.812q-4.635-1.331-7.298-4.114-2.665-2.78-2.665-7.066 0-3.65 1.795-6.489c1.196-1.89 2.886-3.36 5.07-4.401Q94.937.064 99.342.065q4.055.001 7.82 1.361 3.766 1.363 6.199 3.678l-5.155 7.008q-3.941-3.36-8.457-3.36-2.086 0-3.214.724-1.13.726-1.13 2.114.001 1.218 1.1 2.027 1.1.811 4.345 1.795l2.434.753q5.27 1.622 7.993 4.577Q114 23.697 114 28.1q0 3.765-1.97 6.574-1.97 2.81-5.533 4.345t-8.37 1.536q-4.462-.001-8.428-1.448-3.969-1.448-7.038-4.055l4.809-7.474q5.329 4.288 10.773 4.287 2.375 0 3.621-.84 1.246-.839 1.246-2.345z\"/><path fill=\"#E61E14\" d=\"M60.167 0C48.956 0 39.869 9.088 39.869 20.298s9.089 20.297 20.298 20.297c11.21 0 20.298-9.088 20.298-20.297S71.376 0 60.167 0m-.002 30.254c-5.5 0-9.956-4.458-9.956-9.956 0-5.499 4.458-9.957 9.956-9.957 5.499 0 9.957 4.458 9.957 9.957 0 5.498-4.458 9.956-9.957 9.956\"/></svg>";

    // Shown in place of a story that could not be read.
    public static string Failure(string message, bool dark) =>
        $"<!doctype html><html lang=\"en\" data-theme=\"{(dark ? "dark" : "light")}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Story unavailable</title><style>{Style}</style></head>"
        + $"<body><article><h1>This story cannot be shown</h1><p class=\"intro\">{WebUtility.HtmlEncode(message)}</p></article></body></html>";

    private static void Figure(StringBuilder page, string url, string caption, string? credit)
    {
        page.Append("<figure><img src=\"").Append(WebUtility.HtmlEncode(url)).Append("\" alt=\"").Append(WebUtility.HtmlEncode(caption)).Append("\">");
        var text = string.Join(" · ", new[] { caption, credit }.Where(t => !string.IsNullOrWhiteSpace(t)));
        if (text.Length > 0) page.Append("<figcaption>").Append(WebUtility.HtmlEncode(text)).Append("</figcaption>");
        page.Append("</figure>");
    }

    private static readonly string[] Months = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

    // `9 november 2026, 08:15`, by hand: the server may run without culture data.
    private static string Dutch(DateTimeOffset at)
    {
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam"); }
        catch (TimeZoneNotFoundException) { zone = TimeZoneInfo.Local; }
        var local = TimeZoneInfo.ConvertTime(at, zone);
        return $"{local.Day} {Months[local.Month - 1]} {local.Year}, {local:HH:mm}";
    }

    // A screen closes a view nobody touches; someone reading inside the frame is touching it, so the page says so.
    private const string Script = "for (const e of ['pointerdown', 'scroll', 'keydown']) addEventListener(e, () => parent.postMessage('hd-news-active', '*'), { passive: true });";

    private const string Style = """
        :root { color-scheme: light; --bg: #fff; --ink: #202020; --muted: #666; --line: #ede9e9; --accent: #e61e14; }
        :root[data-theme="dark"] { color-scheme: dark; --bg: #262626; --ink: #fff; --muted: #b3b3b3; --line: #3a3a3a; --accent: #ff5247; }
        * { box-sizing: border-box; }
        html { background: var(--bg); }
        body { margin: 0; padding: clamp(20px, 5vw, 56px) clamp(20px, 5vw, 56px) 96px; color: var(--ink); font: 500 clamp(19px, 2.4vw, 24px)/1.6 "Rubik Variable", Rubik, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        article { max-width: 44em; margin: 0 auto; }
        .meta { display: flex; align-items: center; gap: .6em; margin: 0 0 1em; color: var(--muted); font-size: .72em; font-weight: 700; letter-spacing: .02em; }
        .logo { height: 1.5em; width: auto; color: light-dark(#a69b9c, #fff); }
        h1 { margin: 0 0 .5em; font-size: clamp(30px, 4.6vw, 48px); line-height: 1.12; font-weight: 800; text-wrap: balance; }
        h2 { margin: 1.7em 0 .4em; font-size: 1.25em; line-height: 1.25; font-weight: 800; text-wrap: balance; }
        p { margin: 0 0 1em; text-wrap: pretty; }
        .intro { font-size: 1.12em; font-weight: 600; color: var(--muted); line-height: 1.45; }
        figure { margin: 1.4em 0; }
        img { display: block; width: 100%; height: auto; border-radius: 18px; background: var(--line); }
        figcaption { margin-top: .55em; color: var(--muted); font-size: .7em; line-height: 1.4; }
        blockquote { margin: 1.4em 0; padding: 0 0 0 1.1em; border-left: 1px solid var(--accent); font-size: 1.12em; font-weight: 700; line-height: 1.4; }
        blockquote p { margin: 0 0 .4em; }
        footer { color: var(--muted); font-size: .7em; font-weight: 600; }
        em, i { font-style: italic; }
        """;
}
