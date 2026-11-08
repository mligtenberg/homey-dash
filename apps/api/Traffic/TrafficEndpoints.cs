using HomeyDash.Api.Accounts;
using HomeyDash.Api.Data;
using HomeyDash.Api.Weather;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Traffic;

public static class TrafficEndpoints
{
    // ApiKey may be left out to keep the current key, such as when only the name changes.
    public sealed record TomTomAccountChange(string? Name, string? ApiKey);

    public sealed record TomTomAccountInfo(int Id, string Name);

    // Fake: the configuration runs HomeyDash against FakeTraffic, whose one account can't be changed.
    public sealed record TomTomAccountsInfo(bool Fake, IReadOnlyList<TomTomAccountInfo> Accounts);

    public static IServiceCollection AddTraffic(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("Traffic").Get<TrafficOptions>() ?? new TrafficOptions();
        services.AddSingleton(options);
        services.AddSingleton<TomTomAccounts>();
        if (options.Fake)
        {
            services.AddSingleton<ITraffic, FakeTraffic>();
        }
        else
        {
            services.AddHttpClient(TomTomClient.HttpClientName, TomTomClient.ConfigureHttpClient);
            services.AddSingleton<ITraffic, TomTomClient>();
        }
        services.AddSingleton<TrafficWatcher>();
        services.AddHostedService(s => s.GetRequiredService<TrafficWatcher>());
        return services;
    }

    // Reads the accounts kept in the database, before the watcher starts.
    public static void LoadTraffic(this IServiceProvider services)
    {
        services.GetRequiredService<TomTomAccounts>().Set(services.GetRequiredService<TrafficOptions>().Fake
            ? [FakeTraffic.Account]
            : services.GetRequiredService<HomeyDashDbContext>().TomTomAccounts.AsNoTracking().ToList());
    }

    public static void MapTraffic(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/accounts/tomtom");

        group.MapGet("/", (TrafficOptions options, TomTomAccounts accounts) => Info(options, accounts));

        // TomTom checks the key before it is kept.
        group.MapPost("/", async (TomTomAccountChange body, TrafficOptions options, TomTomAccounts accounts, ITraffic traffic,
            HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            var (account, problem) = await CheckAsync(body, null, accounts, traffic, ct);
            if (account is null) return problem!;
            db.TomTomAccounts.Add(account);
            await db.SaveChangesAsync(ct);
            accounts.Set(await db.TomTomAccounts.AsNoTracking().ToListAsync(ct));
            return Info(options, accounts);
        });

        group.MapPut("/{id:int}", async (int id, TomTomAccountChange body, TrafficOptions options, TomTomAccounts accounts, ITraffic traffic,
            HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            if (await db.TomTomAccounts.FindAsync([id], ct) is not { } stored) return Results.NotFound();
            var (account, problem) = await CheckAsync(body, stored, accounts, traffic, ct);
            if (account is null) return problem!;
            db.Entry(stored).State = EntityState.Detached;
            db.TomTomAccounts.Update(account);
            await db.SaveChangesAsync(ct);
            accounts.Set(await db.TomTomAccounts.AsNoTracking().ToListAsync(ct));
            return Info(options, accounts);
        });

        // Traffic tiles and widgets that name it show no traffic until they are given another account.
        group.MapDelete("/{id:int}", async (int id, TrafficOptions options, TomTomAccounts accounts, HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            if (await db.TomTomAccounts.FindAsync([id], ct) is not { } account) return Results.NotFound();
            db.TomTomAccounts.Remove(account);
            await db.SaveChangesAsync(ct);
            accounts.Set(await db.TomTomAccounts.AsNoTracking().ToListAsync(ct));
            return Info(options, accounts);
        });

        // Places by name, for the origin and destination of a route: from two letters, named in ?language= (such as nl) where
        // TomTom can, found with the account's key (?account=, the oldest when none is named). The key never leaves HomeyDash.
        api.MapGet("/traffic/places", async (string? query, string? language, int? account, TomTomAccounts accounts, ITraffic traffic,
            CancellationToken ct) =>
        {
            query = query?.Trim() ?? "";
            if (query.Length < 2) return Results.Ok(Array.Empty<PlaceMatch>());
            if (accounts.For(account) is not { } tomtom)
                return Results.Problem("Set up a TomTom account under Accounts first.", statusCode: StatusCodes.Status409Conflict);
            language = language is { Length: 2 } && language.All(char.IsAsciiLetterLower) ? language : "en";
            try
            {
                return Results.Ok(await traffic.SearchAsync(tomtom.ApiKey, query, language, ct));
            }
            catch (TrafficException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });
    }

    private static async Task<(TomTomAccount? Account, IResult? Problem)> CheckAsync(TomTomAccountChange body, TomTomAccount? stored,
        TomTomAccounts accounts, ITraffic traffic, CancellationToken ct)
    {
        Dictionary<string, string[]> errors = [];
        if (AccountEndpoints.ValidateName(body.Name, accounts.All.Where(a => a.Id != stored?.Id).Select(a => a.Name)) is { } nameError)
            errors["name"] = [nameError];
        var apiKey = string.IsNullOrWhiteSpace(body.ApiKey) ? stored?.ApiKey : body.ApiKey.Trim();
        if (apiKey is null) errors["apiKey"] = ["Enter an API key, made in the TomTom developer portal."];
        if (errors.Count > 0) return (null, Results.ValidationProblem(errors));
        // A key that is kept was checked when it came.
        if (apiKey != stored?.ApiKey)
        {
            try
            {
                await traffic.CheckAsync(apiKey!, ct);
            }
            catch (TrafficException e) when (e.KeyRefused)
            {
                return (null, Results.ValidationProblem(new Dictionary<string, string[]> { ["apiKey"] = [e.Message] }));
            }
            catch (TrafficException e)
            {
                return (null, Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway));
            }
        }
        return (new TomTomAccount(apiKey!) { Id = stored?.Id ?? 0, Name = body.Name!.Trim() }, null);
    }

    private static IResult Info(TrafficOptions options, TomTomAccounts accounts) =>
        Results.Ok(new TomTomAccountsInfo(options.Fake, accounts.All.Select(a => new TomTomAccountInfo(a.Id, a.Name)).ToList()));

    private static IResult FakeProblem() =>
        Results.Problem("HomeyDash runs against a fake TomTom, set in its configuration.", statusCode: StatusCodes.Status409Conflict);
}
