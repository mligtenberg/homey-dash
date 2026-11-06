using HomeyDash.AirPlay;
using HomeyDash.Api.Plex;
using Microsoft.AspNetCore.Mvc;

namespace HomeyDash.Api.AirPlay;

public static class AirPlayEndpoints
{
    public sealed record Pairing(string? Pin);

    public static IServiceCollection AddAirPlay(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("AirPlay").Get<AirPlayOptions>() ?? new AirPlayOptions();
        if (options.Fake) options.Enabled = true;
        // Pairings are kept next to the database unless told otherwise.
        if (!configuration.GetSection("AirPlay:CredentialsPath").Exists())
        {
            var database = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(configuration.GetConnectionString("HomeyDash")).DataSource;
            options.CredentialsPath = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(database)) ?? "", "airplay-credentials.json");
        }
        services.AddSingleton(options);
        services.AddSingleton<AirPlayNow>();
        // The stream check also fetches from Plex, whichever client is in use.
        services.AddHttpClient();
        if (options.Fake)
        {
            services.AddSingleton<FakeAirPlay>();
            services.AddSingleton<IAirPlay>(s => s.GetRequiredService<FakeAirPlay>());
        }
        else
        {
            services.AddSingleton<IAirPlay, NativeAirPlay>();
        }
        return services;
    }

    public static void MapAirPlay(this RouteGroupBuilder api)
    {
        var airPlay = api.MapGroup("/accounts/airplay");

        // Looking for receivers takes a few seconds.
        airPlay.MapGet("/", async (AirPlayOptions options, IAirPlay service, CancellationToken ct) =>
        {
            if (!options.Enabled) return new AirPlayStatus(false, false, false, null, []);
            try
            {
                return new AirPlayStatus(true, options.Fake, true, null, await service.DevicesAsync(ct));
            }
            catch (AirPlayException e)
            {
                return new AirPlayStatus(true, options.Fake, false, e.Message, []);
            }
        });

        // For diagnosing a receiver that starts a stream and stops it at once: what the Plex server serves for an item, as a
        // receiver would fetch it. The oldest Plex account and its newest movie or episode unless told otherwise. Never
        // shows the token.
        airPlay.MapGet("/stream-check", async (int? account, string? item, PlexAccounts accounts, PlexWatcher watcher,
            [FromServices] IHttpClientFactory http, CancellationToken ct) =>
        {
            if (accounts.For(account) is not { Connection: { } server } plex) return Results.Problem("Sign in with Plex first.", statusCode: StatusCodes.Status409Conflict);
            var id = item ?? watcher.Snapshot.Accounts.FirstOrDefault(a => a.AccountId == plex.Id)?.Libraries
                .SelectMany(l => l.Recent).FirstOrDefault(i => i.Kind is "movie" or "episode")?.Id;
            return id is null
                ? Results.Problem("There is no movie or episode to check.", statusCode: StatusCodes.Status404NotFound)
                : Results.Ok(new { item = id, check = await PlexStreamCheck.RunAsync(http.CreateClient(PlexClient.HttpClientName), server, id, ct) });
        });

        // The receiver shows a PIN for finish.
        airPlay.MapPost("/{id}/pair", async (string id, AirPlayOptions options, IAirPlay service, CancellationToken ct) =>
            await Pair(options, () => service.PairStartAsync(id, ct)));

        airPlay.MapPost("/{id}/pair/finish", async (string id, Pairing body, AirPlayOptions options, IAirPlay service, CancellationToken ct) =>
            string.IsNullOrWhiteSpace(body.Pin)
                ? Results.ValidationProblem(new Dictionary<string, string[]> { ["pin"] = ["Enter the PIN the Apple TV shows."] })
                : await Pair(options, () => service.PairFinishAsync(id, body.Pin.Trim(), ct)));
    }

    private static async Task<IResult> Pair(AirPlayOptions options, Func<Task> pair)
    {
        if (!options.Enabled) return Results.Problem("AirPlay isn't set up.", statusCode: StatusCodes.Status409Conflict);
        try
        {
            await pair();
            return Results.NoContent();
        }
        catch (AirPlayException e)
        {
            return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
        }
    }
}
