using HomeyDash.Api.Accounts;
using HomeyDash.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Plex;

// A Plex account as Management sees it. Its tokens never leave the backend.
public sealed record PlexAccountInfo(int Id, string Name, string? Username, string? ServerId, string? ServerName);

// Fake: the configuration runs HomeyDash against FakePlex, whose one account can't be changed. Oldest first.
public sealed record PlexAccountsInfo(bool Fake, IReadOnlyList<PlexAccountInfo> Accounts, PlexSignInStatus? SignIn);

public sealed record PlexServerInfo(string Id, string Name, bool Owned);

public static class PlexEndpoints
{
    public sealed record ServerChoice(string? Id);

    // A new account needs a name; AccountId signs in an existing one again.
    public sealed record SignInRequest(string? Name, int? AccountId);

    public sealed record AccountChange(string? Name);

    public static IServiceCollection AddPlex(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("Plex").Get<PlexOptions>() ?? new PlexOptions();
        services.AddSingleton(options);
        services.AddSingleton<PlexAccounts>();
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
        services.AddSingleton<PlexTimeline>();
        return services;
    }

    // Reads the accounts kept in the database, before the watcher starts.
    public static void LoadPlex(this IServiceProvider services)
    {
        services.GetRequiredService<PlexAccounts>().Set(services.GetRequiredService<PlexOptions>().Fake
            ? [FakePlex.Account]
            : services.GetRequiredService<HomeyDashDbContext>().PlexAccounts.AsNoTracking().ToList());
    }

    public static void MapPlex(this RouteGroupBuilder api)
    {
        var plexAccounts = api.MapGroup("/accounts/plex");

        plexAccounts.MapGet("/", (PlexOptions options, PlexAccounts accounts, PlexSignIn signIn) => Info(options, accounts, signIn));

        // Starts signing in: Management opens the url, Plex's own page, for someone to approve HomeyDash.
        plexAccounts.MapPost("/sign-in", async (SignInRequest body, PlexOptions options, PlexAccounts accounts, PlexSignIn signIn,
            CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            if (body.AccountId is not null && accounts.Find(body.AccountId) is null) return Results.NotFound();
            if (body.AccountId is null
                && AccountEndpoints.ValidateName(body.Name, accounts.All.Select(a => a.Name)) is { } nameError)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [nameError] });
            try
            {
                return Results.Ok(new { url = await signIn.StartAsync(body.Name?.Trim() ?? "", body.AccountId, ct) });
            }
            catch (PlexException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        plexAccounts.MapDelete("/sign-in", (PlexSignIn signIn) =>
        {
            signIn.Cancel();
            return Results.NoContent();
        });

        plexAccounts.MapPut("/{id:int}", async (int id, AccountChange body, PlexOptions options, PlexAccounts accounts,
            PlexSignIn signIn, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            if (accounts.Find(id) is not { } account) return Results.NotFound();
            if (AccountEndpoints.ValidateName(body.Name, accounts.All.Where(a => a.Id != id).Select(a => a.Name)) is { } nameError)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [nameError] });
            await signIn.SaveAsync(account with { Name = body.Name!.Trim() }, ct);
            return Info(options, accounts, signIn);
        });

        // The servers the account can use, to choose from.
        plexAccounts.MapGet("/{id:int}/servers", async (int id, PlexAccounts accounts, IPlex plex, CancellationToken ct) =>
        {
            if (accounts.Find(id) is not { } account) return Results.NotFound();
            try
            {
                var servers = await plex.ServersAsync(account.ClientId, account.Token, ct);
                return Results.Ok(servers.Select(s => new PlexServerInfo(s.Id, s.Name, s.Owned)).OrderByDescending(s => s.Owned).ThenBy(s => s.Name));
            }
            catch (PlexException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        plexAccounts.MapPut("/{id:int}/server", async (int id, ServerChoice body, PlexOptions options, PlexAccounts accounts, IPlex plex,
            PlexSignIn signIn, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            if (accounts.Find(id) is not { } account) return Results.NotFound();
            try
            {
                var server = (await plex.ServersAsync(account.ClientId, account.Token, ct)).FirstOrDefault(s => s.Id == body.Id);
                if (server is null)
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["id"] = ["Choose one of the account's servers."] });
                await signIn.UseServerAsync(account, server, ct);
                return Info(options, accounts, signIn);
            }
            catch (PlexException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        // Its Plex tiles show Plex as not set up until they are given another account.
        plexAccounts.MapDelete("/{id:int}", async (int id, PlexOptions options, PlexAccounts accounts, PlexSignIn signIn, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            if (accounts.Find(id) is null) return Results.NotFound();
            if (signIn.Status?.AccountId == id) signIn.Cancel();
            await signIn.RemoveAsync(id, ct);
            return Info(options, accounts, signIn);
        });

        // Posters and artwork, scaled by the account's server (the oldest account's when none is given). Only the
        // library's own pictures, so this can't reach the rest of it.
        api.MapGet("/plex/image", async (string? path, int? w, int? h, int? account, PlexAccounts accounts, IPlex plex,
            HttpContext http, CancellationToken ct) =>
        {
            // Or an actor's picture, which Plex hosts itself or has from TMDB.
            var own = path is not null && path.StartsWith("/library/metadata/", StringComparison.Ordinal) && !path.Contains("..") && !path.Contains('?');
            var actor = path is not null && (path.StartsWith("https://metadata-static.plex.tv/", StringComparison.Ordinal) || path.StartsWith("https://image.tmdb.org/t/p/", StringComparison.Ordinal))
                && !path.Contains("..") && !path.Contains('@');
            if (path is null || !(own || actor)) return Results.NotFound();
            if (accounts.For(account)?.Connection is not { } server) return NotSignedIn();
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

        // A track's file, or a show's theme (theme=true), from the account's server, for a screen to play: the screen never has
        // the server's address or token. A Range request is passed on, so a player can skip.
        api.MapGet("/plex/audio", async (string? item, bool? theme, int? account, PlexAccounts accounts, IPlex plex, HttpContext http,
            CancellationToken ct) =>
        {
            if (item is null || item.Length is 0 or > 12 || !item.All(char.IsAsciiDigit)) return Results.NotFound();
            if (accounts.For(account)?.Connection is not { } server) return NotSignedIn();
            try
            {
                var audio = await plex.AudioAsync(server, item, theme == true, http.Request.Headers.Range.ToString() is { Length: > 0 } range ? range : null, ct);
                if (audio is null) return Results.NotFound();
                await WriteAudioAsync(http, audio, ct);
                return Results.Empty;
            }
            catch (PlexException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        // A movie or episode as a video a screen plays, made by the account's server; like the audio, the screen never has the server's
        // address or token. The stream can't be skipped through.
        api.MapGet("/plex/video", async (string? item, int? account, PlexAccounts accounts, IPlex plex, HttpContext http, CancellationToken ct) =>
        {
            if (item is null || item.Length is 0 or > 12 || !item.All(char.IsAsciiDigit)) return Results.NotFound();
            if (accounts.For(account)?.Connection is not { } server) return NotSignedIn();
            try
            {
                var video = await plex.VideoAsync(server, item, ct);
                if (video is null) return Results.NotFound();
                await WriteAudioAsync(http, video, ct);
                return Results.Empty;
            }
            catch (PlexException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });
    }

    private static async Task WriteAudioAsync(HttpContext http, PlexAudio audio, CancellationToken ct)
    {
        using (audio.Content)
        {
            http.Response.StatusCode = audio.Status;
            http.Response.ContentType = audio.ContentType;
            if (audio.Length is { } length) http.Response.ContentLength = length;
            if (audio.ContentRange is { } contentRange) http.Response.Headers.ContentRange = contentRange;
            http.Response.Headers.AcceptRanges = "bytes";
            await audio.Content.CopyToAsync(http.Response.Body, ct);
        }
    }

    private static IResult Info(PlexOptions options, PlexAccounts accounts, PlexSignIn signIn) =>
        Results.Ok(new PlexAccountsInfo(
            options.Fake,
            accounts.All.Select(a => new PlexAccountInfo(a.Id, a.Name, a.Username, a.ServerId, a.ServerName)).ToList(),
            signIn.Status));

    private static IResult NotSignedIn() =>
        Results.Problem("Sign in with Plex under Accounts first.", statusCode: StatusCodes.Status409Conflict);

    private static IResult FakeProblem() =>
        Results.Problem("HomeyDash runs against a fake Plex, set in its configuration.", statusCode: StatusCodes.Status409Conflict);
}
