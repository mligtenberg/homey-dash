using System.Text;
using Microsoft.Extensions.Caching.Memory;

namespace HomeyDash.Api.News;

public static class NewsSetup
{
    public static IServiceCollection AddNews(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("News").Get<NewsOptions>() ?? new NewsOptions();
        services.AddSingleton(options);
        if (options.Fake)
        {
            services.AddSingleton<INewsFeeds, FakeNews>();
            services.AddMemoryCache();
            services.AddSingleton<INewsArticles, FakeArticles>();
            services.AddSingleton<INosVideos, FakeNosVideos>();
        }
        else
        {
            services.AddHttpClient(RssNewsFeeds.HttpClientName, RssNewsFeeds.ConfigureHttpClient);
            services.AddSingleton<INewsFeeds, RssNewsFeeds>();
            services.AddMemoryCache();
            services.AddSingleton<INewsArticles, NosArticles>();
            services.AddSingleton<INosVideos, NosVideos>();
        }
        services.AddSingleton<HomeyDash.Api.AirPlay.NosPlayback>();
        services.AddSingleton<NewsWatcher>();
        services.AddHostedService(s => s.GetRequiredService<NewsWatcher>());
        return services;
    }

    public static void MapNews(this RouteGroupBuilder api)
    {
        // A story as a reader view for a news tile's detail view to frame (ADR-0016). Any article on nos.nl, nothing else.
        api.MapGet("/news/article", async (string source, string link, DateTimeOffset? at, bool? dark, INewsArticles articles, HttpContext http, CancellationToken ct) =>
        {
            http.Response.Headers.ContentSecurityPolicy = ArticlePage.Policy;
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            if (!NosArticles.IsArticle(link))
                return Results.Content(ArticlePage.Failure("That is not a story on nos.nl.", dark == true), "text/html; charset=utf-8", Encoding.UTF8, StatusCodes.Status404NotFound);
            try
            {
                var name = NewsSource.Find(source)?.Name ?? "NOS";
                return Results.Content(ArticlePage.Render(await articles.ReadAsync(link, ct), name, at, dark == true), "text/html; charset=utf-8");
            }
            catch (NewsException e)
            {
                return Results.Content(ArticlePage.Failure(e.Message, dark == true), "text/html; charset=utf-8", Encoding.UTF8, StatusCodes.Status502BadGateway);
            }
        });

        // The stories of any source, for the categories of a news tile's detail view: a source in use from the watcher, another read now and kept for 5 minutes.
        api.MapGet("/news/feed", async (string source, NewsWatcher watcher, INewsFeeds feeds, IMemoryCache cache, TimeProvider time, CancellationToken ct) =>
        {
            if (NewsSource.Find(source) is not { } known) return Results.NotFound();
            if (watcher.All.FirstOrDefault(f => f.Source == known.Id) is { Status: "connected" } watched) return Results.Ok(watched);
            if (cache.TryGetValue("feed:" + known.Id, out NewsFeed? kept) && kept is not null) return Results.Ok(kept);
            try
            {
                var feed = new NewsFeed(known.Id, known.Name, "connected", null, await feeds.ReadAsync(known, ct), time.GetUtcNow());
                cache.Set("feed:" + known.Id, feed, TimeSpan.FromMinutes(5));
                return Results.Ok(feed);
            }
            catch (NewsException e)
            {
                return Results.Ok(new NewsFeed(known.Id, known.Name, "disconnected", e.Message, [], null));
            }
        });

        // Livestreams on now and coming, and the newest videos; a video's stream when one is opened.
        api.MapGet("/news/live", async (INosVideos videos, CancellationToken ct) => await Read(() => videos.LiveAsync(ct)));
        api.MapGet("/news/videos", async (INosVideos videos, CancellationToken ct) => await Read(() => videos.VideosAsync(ct)));
        api.MapGet("/news/video/{id}", async (string id, INosVideos videos, CancellationToken ct) => await Read(async () => new { url = await videos.StreamAsync(id, ct) }));
    }

    private static async Task<IResult> Read<T>(Func<Task<T>> read)
    {
        try
        {
            return Results.Ok(await read());
        }
        catch (NewsException e)
        {
            return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
        }
    }
}
