using HomeyDash.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Plex;

// The Plex account as Management sees it. Its tokens never leave the backend.
public sealed record PlexAccountInfo(
    bool Fake, bool SignedIn, string? Username, string? ServerId, string? ServerName, PlexSignInStatus? SignIn);

public sealed record PlexServerInfo(string Id, string Name, bool Owned);

public static class PlexEndpoints
{
    public sealed record ServerChoice(string? Id);

    public static IServiceCollection AddPlex(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("Plex").Get<PlexOptions>() ?? new PlexOptions();
        services.AddSingleton(options);
        services.AddSingleton<CurrentPlexAccount>();
        if (options.Fake)
        {
            services.AddSingleton<IPlex, FakePlex>();
        }
        else
        {
            services.AddHttpClient(PlexClient.HttpClientName);
            services.AddSingleton<IPlex, PlexClient>();
        }
        services.AddSingleton<PlexWatcher>();
        services.AddHostedService(s => s.GetRequiredService<PlexWatcher>());
        services.AddSingleton<PlexSignIn>();
        return services;
    }

    // Reads the account kept in the database, before the watcher starts.
    public static void LoadPlex(this IServiceProvider services)
    {
        services.GetRequiredService<CurrentPlexAccount>().Account = services.GetRequiredService<PlexOptions>().Fake
            ? FakePlex.Account
            : services.GetRequiredService<HomeyDashDbContext>().PlexAccounts.AsNoTracking().SingleOrDefault();
    }

    public static void MapPlex(this RouteGroupBuilder api)
    {
        var account = api.MapGroup("/accounts/plex");

        account.MapGet("/", (PlexOptions options, CurrentPlexAccount current, PlexSignIn signIn) => Info(options, current, signIn));

        // Starts signing in: Management opens the url, Plex's own page, for someone to approve HomeyDash.
        account.MapPost("/sign-in", async (PlexOptions options, PlexSignIn signIn, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            try
            {
                return Results.Ok(new { url = await signIn.StartAsync(ct) });
            }
            catch (PlexException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        account.MapDelete("/sign-in", (PlexSignIn signIn) =>
        {
            signIn.Cancel();
            return Results.NoContent();
        });

        // The servers the account can use, to choose from.
        account.MapGet("/servers", async (CurrentPlexAccount current, IPlex plex, CancellationToken ct) =>
        {
            if (current.Account is not { } signedIn) return NotSignedIn();
            try
            {
                var servers = await plex.ServersAsync(signedIn.ClientId, signedIn.Token, ct);
                return Results.Ok(servers.Select(s => new PlexServerInfo(s.Id, s.Name, s.Owned)).OrderByDescending(s => s.Owned).ThenBy(s => s.Name));
            }
            catch (PlexException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        account.MapPut("/server", async (ServerChoice body, PlexOptions options, CurrentPlexAccount current, IPlex plex,
            PlexSignIn signIn, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            if (current.Account is not { } signedIn) return NotSignedIn();
            try
            {
                var server = (await plex.ServersAsync(signedIn.ClientId, signedIn.Token, ct)).FirstOrDefault(s => s.Id == body.Id);
                if (server is null)
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["id"] = ["Choose one of the account's servers."] });
                await signIn.UseServerAsync(signedIn, server, ct);
                return Info(options, current, signIn);
            }
            catch (PlexException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        // Plex tiles show Plex as not set up until someone signs in again.
        account.MapDelete("/", async (PlexOptions options, PlexSignIn signIn, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            signIn.Cancel();
            await signIn.SaveAsync(null, ct);
            return Results.NoContent();
        });

        // Posters and artwork, scaled by the server. Only the library's own pictures, so this can't reach the rest of it.
        api.MapGet("/plex/image", async (string? path, int? w, int? h, CurrentPlexAccount current, IPlex plex,
            HttpContext http, CancellationToken ct) =>
        {
            if (path is null || !path.StartsWith("/library/metadata/", StringComparison.Ordinal) || path.Contains("..") || path.Contains('?'))
                return Results.NotFound();
            if (current.Account?.Connection is not { } server) return NotSignedIn();
            try
            {
                var image = await plex.ImageAsync(server, path, Math.Clamp(w ?? 400, 32, 1920), Math.Clamp(h ?? 600, 32, 1920), ct);
                if (image is not { } found) return Results.NotFound();
                http.Response.Headers.CacheControl = "public, max-age=86400";
                return Results.Stream(found.Content, found.ContentType);
            }
            catch (PlexException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });
    }

    private static IResult Info(PlexOptions options, CurrentPlexAccount current, PlexSignIn signIn)
    {
        var account = current.Account;
        return Results.Ok(new PlexAccountInfo(options.Fake, account is not null, account?.Username, account?.ServerId,
            account?.ServerName, signIn.Status));
    }

    private static IResult NotSignedIn() =>
        Results.Problem("Sign in with Plex under Accounts first.", statusCode: StatusCodes.Status409Conflict);

    private static IResult FakeProblem() =>
        Results.Problem("HomeyDash runs against a fake Plex, set in its configuration.", statusCode: StatusCodes.Status409Conflict);
}
