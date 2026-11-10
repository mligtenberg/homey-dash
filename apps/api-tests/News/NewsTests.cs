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
