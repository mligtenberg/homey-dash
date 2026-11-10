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
        }
        else
        {
            services.AddHttpClient(RssNewsFeeds.HttpClientName, RssNewsFeeds.ConfigureHttpClient);
            services.AddSingleton<INewsFeeds, RssNewsFeeds>();
        }
        services.AddSingleton<NewsWatcher>();
        services.AddHostedService(s => s.GetRequiredService<NewsWatcher>());
        return services;
    }
}
