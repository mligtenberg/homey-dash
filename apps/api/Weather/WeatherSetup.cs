namespace HomeyDash.Api.Weather;

public static class WeatherSetup
{
    public static IServiceCollection AddWeather(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("Weather").Get<WeatherOptions>() ?? new WeatherOptions();
        services.AddSingleton(options);
        if (options.Fake)
        {
            services.AddSingleton<IWeatherSource, FakeWeather>();
        }
        else
        {
            services.AddHttpClient(WeatherSource.HttpClientName, WeatherSource.ConfigureHttpClient);
            services.AddSingleton<IWeatherSource, WeatherSource>();
        }
        services.AddSingleton<WeatherWatcher>();
        services.AddHostedService(s => s.GetRequiredService<WeatherWatcher>());
        return services;
    }

    public static void MapWeather(this RouteGroupBuilder api)
    {
        // Towns by name, for a weather tile's place: from two letters, named in ?language= (such as nl) where Open-Meteo can.
        api.MapGet("/weather/places", async (string? query, string? language, IWeatherSource source, CancellationToken ct) =>
        {
            query = query?.Trim() ?? "";
            if (query.Length < 2) return Results.Ok(Array.Empty<PlaceMatch>());
            language = language is { Length: 2 } && language.All(char.IsAsciiLetterLower) ? language : "en";
            try
            {
                return Results.Ok(await source.SearchAsync(query, language, ct));
            }
            catch (WeatherException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });
    }
}
