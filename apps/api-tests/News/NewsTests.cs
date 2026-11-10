using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using HomeyDash.Api.News;
using HomeyDash.Api.Tests.Traffic;

namespace HomeyDash.Api.Tests.News;

public sealed class RssParseTests
{
    private const string Rss = """
        <rss version="2.0"><channel>
          <item><title>Older &amp; wiser</title><description>&lt;p&gt;Old story&lt;/p&gt;</description><link>https://nos.nl/a</link><pubDate>Mon, 09 Nov 2026 08:00:00 +0100</pubDate></item>
          <item><title>Newest</title><description>New story</description><link>https://nos.nl/b</link><pubDate>Mon, 09 Nov 2026 09:00:00 +0100</pubDate><enclosure url="https://nos.nl/b.jpg" type="image/jpeg"/></item>
          <item><description>No title, left out</description></item>
        </channel></rss>
        """;

    [Fact]
    public void Stories_AreNewestFirst_WithTheirMarkupRemoved()
    {
        var items = RssNewsFeeds.Parse(Rss, "NOS");

        Assert.Equal(["Newest", "Older & wiser"], items.Select(i => i.Title));
        Assert.Equal("Old story", items[1].Summary);
        Assert.Equal("https://nos.nl/b.jpg", items[0].Image);
    }

    [Fact]
    public void NotAFeed_IsRefused() =>
        Assert.Throws<NewsException>(() => RssNewsFeeds.Parse("<html/>", "NOS"));
}

public sealed class ArticleParseTests
{
    private const string Template = """
        <html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"article":{"title":"Dylan &amp; co","description":"Een fortuin.","headerImage":{"imageAsset":{"copyright":"EPA","Ratio16x9":[{"width":128,"url":"https://images.cdn.nos.nl/a-128.webp"},{"width":1024,"url":"https://images.cdn.nos.nl/a-1024.webp"},{"width":2048,"url":"https://images.cdn.nos.nl/a-2048.webp"}]}},"content":CONTENT}}}}</script></body></html>
        """;

    private static string Page(string content) => Template.Replace("CONTENT", content);

    [Fact]
    public void TheStory_IsReadFromThePagesData()
    {
        var article = NosArticles.Parse(Page("""
            [
            {"__typename":"TextElement","text":"Hij verkocht <em>alles</em>, <a href=\"https://evil\">zie hier</a>\u003cscript>x()\u003c/script>."},
            {"__typename":"HeaderElement","text":"Waarom"},
            {"__typename":"QuoteElement","text":"Veel geld.","source":"Een kenner"},
            {"__typename":"LinkContainerElement"},
            {"__typename":"ImageElement","imageDescription":"De zanger","imageAsset":{"copyright":"ANP","Ratio16x9":[{"width":512,"url":"https://images.cdn.nos.nl/b.webp"}]}}
            ]
            """));

        Assert.Equal("Dylan & co", article.Title);
        Assert.Equal("https://images.cdn.nos.nl/a-1024.webp", article.Image);
        Assert.Equal(["p", "h", "quote", "image"], article.Blocks.Select(b => b.Kind));
        // Emphasis stays; links and scripts go, and everything is escaped.
        Assert.Equal("Hij verkocht <em>alles</em>, zie hier.", article.Blocks[0].Text.Replace("x()", ""));
        Assert.DoesNotContain("<a", article.Blocks[0].Text);
        Assert.DoesNotContain("<script", article.Blocks[0].Text);
    }

    [Fact]
    public void AStoryWithoutPictures_IsStillRead()
    {
        var html = Page("""
            [{"__typename":"TextElement","text":"Tekst."},{"__typename":"ImageElement","imageAsset":null}]
            """).Replace("\"headerImage\":", "\"headerImage\":null,\"x\":");

        var article = NosArticles.Parse(html);

        Assert.Null(article.Image);
        Assert.Equal(["p"], article.Blocks.Select(b => b.Kind));
    }

    [Theory]
    [InlineData("https://resolver.streaming.api.nos.nl/stream?stream=x&profile=hls_unencrypted", true)]
    [InlineData("https://resolver.streaming.api.nos.nl.evil.example/stream", false)]
    [InlineData("http://resolver.streaming.api.nos.nl/stream", false)]
    [InlineData("https://example.com/a.m3u8", false)]
    public void OnlyNosStreamsAreHandedOut(string url, bool expected) => Assert.Equal(expected, NosVideos.Playable(url));

    [Fact]
    public void APageWithoutTheStory_IsRefused() =>
        Assert.Throws<NewsException>(() => NosArticles.Parse("<html><body>Nothing</body></html>"));

    [Theory]
    [InlineData("https://nos.nl/artikel/1", true)]
    [InlineData("https://www.nos.nl/artikel/1", true)]
    [InlineData("http://nos.nl/artikel/1", false)]
    [InlineData("https://nos.nl.evil.example/artikel/1", false)]
    [InlineData("https://example.com/nos.nl", false)]
    [InlineData(null, false)]
    public void OnlyNosIsEverFetched(string? link, bool expected) => Assert.Equal(expected, NosArticles.IsNos(link));

    [Theory]
    [InlineData("https://nos.nl/l/2638863", true)]
    [InlineData("https://nos.nl/artikel/2638863-titel", true)]
    [InlineData("https://nos.nl/sport/artikel/1-titel", true)]
    [InlineData("https://nos.nl/l/abc", false)]
    [InlineData("https://nos.nl/video/1-titel", false)]
    [InlineData("https://nos.nl/", false)]
    public void OnlyArticlesAreRead(string link, bool expected) => Assert.Equal(expected, NosArticles.IsArticle(link));

    [Fact]
    public void TheReaderView_EscapesWhatItShows()
    {
        var page = ArticlePage.Render(new NewsArticle("<b>Title</b>", null, null, null, [new("p", "ok")]), "NOS", null, dark: true);

        Assert.Contains("&lt;b&gt;Title&lt;/b&gt;", page);
        Assert.Contains("data-theme=\"dark\"", page);
    }
}

// Against FakeNews.
public sealed class NewsApiTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private readonly HttpClient _client = factory.CreateClient();
    private Microsoft.AspNetCore.SignalR.Client.HubConnection? _hub;

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (_hub is not null) await _hub.DisposeAsync();
    }

    [Fact]
    public async Task ANewsTileInADraft_GetsItsStories()
    {
        _hub = await TrafficHelpers.ConnectAsync(factory);
        var created = await _client.PostAsJsonAsync("/api/dashboards", new { name = "News" });
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        var draft = new
        {
            rows = 4,
            sections = new[] { new { id = "s", title = "", tiles = new[] { new { id = "t", kind = "news", size = "wide", position = new { column = 0, row = 0 }, settings = new { target = (string?)null, source = "nos-sport" } } } } },
        };
        (await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft", draft)).EnsureSuccessStatusCode();

        var deadline = DateTime.UtcNow.AddSeconds(5);
        JsonElement feed;
        while (true)
        {
            var all = (await _hub.InvokeAsync<JsonElement>("News")).EnumerateArray().ToArray();
            if (all.FirstOrDefault(f => f.GetProperty("source").GetString() == "nos-sport") is { ValueKind: JsonValueKind.Object } found
                && found.GetProperty("status").GetString() == "connected") { feed = found; break; }
            if (DateTime.UtcNow > deadline) throw new TimeoutException("The news did not get there within 5 seconds");
            await Task.Delay(50);
        }

        Assert.Equal("NOS Sport", feed.GetProperty("name").GetString());
        Assert.True(feed.GetProperty("items").GetArrayLength() > 0);
    }

    [Fact]
    public async Task AStoryOfAFeedInUse_IsShownAsAReaderView_AndNoOtherIs()
    {
        _hub = await TrafficHelpers.ConnectAsync(factory);
        var created = await _client.PostAsJsonAsync("/api/dashboards", new { name = "News reader" });
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        var draft = new
        {
            rows = 4,
            sections = new[] { new { id = "s", title = "", tiles = new[] { new { id = "t", kind = "news", size = "wide", position = new { column = 0, row = 0 }, settings = new { target = (string?)null, source = "nos-economie" } } } } },
        };
        (await _client.PutAsJsonAsync($"/api/dashboards/{id}/draft", draft)).EnsureSuccessStatusCode();

        var deadline = DateTime.UtcNow.AddSeconds(5);
        string link;
        while (true)
        {
            var all = (await _hub.InvokeAsync<JsonElement>("News")).EnumerateArray().ToArray();
            if (all.FirstOrDefault(f => f.GetProperty("source").GetString() == "nos-economie") is { ValueKind: JsonValueKind.Object } found
                && found.GetProperty("status").GetString() == "connected") { link = found.GetProperty("items")[0].GetProperty("link").GetString()!; break; }
            if (DateTime.UtcNow > deadline) throw new TimeoutException("The news did not get there within 5 seconds");
            await Task.Delay(50);
        }

        var story = await _client.GetAsync($"/api/news/article?source=nos-economie&link={Uri.EscapeDataString(link)}");
        Assert.Equal(HttpStatusCode.OK, story.StatusCode);
        Assert.Equal("text/html", story.Content.Headers.ContentType?.MediaType);
        Assert.Contains("frame-ancestors 'self'", story.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Contains("thuisbatterijen", await story.Content.ReadAsStringAsync());

        foreach (var stranger in new[] { "https://nos.nl/video/1", "https://example.com/artikel/1", "http://nos.nl/artikel/1" })
        {
            var refused = await _client.GetAsync($"/api/news/article?source=nos-economie&link={Uri.EscapeDataString(stranger)}");
            Assert.Equal(HttpStatusCode.NotFound, refused.StatusCode);
        }
    }

    [Fact]
    public async Task AnySourceCanBeRead_ForTheCategories()
    {
        var feed = await _client.GetFromJsonAsync<JsonElement>("/api/news/feed?source=nos-koningshuis");

        Assert.Equal("NOS Koningshuis", feed.GetProperty("name").GetString());
        Assert.True(feed.GetProperty("items").GetArrayLength() > 0);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/news/feed?source=elsewhere")).StatusCode);
    }

    [Fact]
    public async Task LiveStreamsAndVideos_AreListed_AndAVideoHasAStream()
    {
        var live = await _client.GetFromJsonAsync<JsonElement>("/api/news/live");
        Assert.True(live[0].GetProperty("live").GetBoolean());
        Assert.StartsWith("https://", live[0].GetProperty("url").GetString());

        var videos = await _client.GetFromJsonAsync<JsonElement>("/api/news/videos");
        var id = videos[0].GetProperty("id").GetString();
        var stream = await _client.GetFromJsonAsync<JsonElement>($"/api/news/video/{id}");
        Assert.StartsWith("https://", stream.GetProperty("url").GetString());
    }

    [Fact]
    public async Task ALockWidget_NamesOneOfTheSources()
    {
        var display = await DisplaysHelper.CreateAsync(_client);
        var bad = await _client.PutAsJsonAsync($"/api/displays/{display}/lock-screen", new { widgets = new[] { new { kind = "news", spot = "center", source = "elsewhere" } } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var good = await _client.PutAsJsonAsync($"/api/displays/{display}/lock-screen", new { widgets = new[] { new { kind = "news", spot = "center", source = "nos-tech" } } });
        Assert.Equal(HttpStatusCode.OK, good.StatusCode);
    }
}

internal static class DisplaysHelper
{
    public static async Task<string> CreateAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/displays", new { name = "Hall", screenId = Guid.NewGuid() });
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }
}
