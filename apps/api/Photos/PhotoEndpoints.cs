using HomeyDash.Api.Accounts;
using HomeyDash.Api.Data;
using HomeyDash.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Photos;

// A photo set as the apps see it: Target is what a photo tile stores, Dashboards names those whose draft shows it.
// It has an AlbumId or a Selection. SyncError says why the last sync with Immich failed; the photos are then those of
// the sync before.
public sealed record PhotoSetView(
    Guid Id, string Name, string Target, string? AlbumId, string AlbumName, PhotoSelection? Selection, IReadOnlyList<Photo> Photos,
    DateTimeOffset? SyncedAt, int SkippedVideos, string? SyncError, IReadOnlyList<string> Dashboards);

// The Immich account as Management sees it. Its key never leaves the backend.
public sealed record ImmichAccountInfo(bool Fake, string? Address);

public static class PhotoEndpoints
{
    // An album or a selection. Name may be left out to take the album's.
    public sealed record NewPhotoSet(string? Name, string? AlbumId, PhotoSelection? Selection);

    // Leaves out what stays the same. An album replaces a selection, and the other way round.
    public sealed record PhotoSetChange(string? Name, string? AlbumId, PhotoSelection? Selection);

    // ApiKey may be left out to keep the current key, such as when only the address changes.
    public sealed record ImmichAccountChange(string? Address, string? ApiKey);

    public static IServiceCollection AddPhotos(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("Immich").Get<ImmichOptions>() ?? new ImmichOptions();
        services.AddSingleton(options);
        services.AddSingleton<CurrentImmichAccount>();
        if (options.Fake)
        {
            services.AddSingleton<IImmich, FakeImmich>();
        }
        else
        {
            services.AddHttpClient(ImmichClient.HttpClientName);
            services.AddSingleton<IImmich, ImmichClient>();
        }
        services.AddSingleton<PhotoSetIndex>();
        services.AddSingleton<PhotoSync>();
        services.AddHostedService(s => s.GetRequiredService<PhotoSync>());
        return services;
    }

    // Reads which photo sets exist, before anything counts missing tiles, and the Immich account.
    public static void LoadPhotoSets(this IServiceProvider services)
    {
        var db = services.GetRequiredService<HomeyDashDbContext>();
        var index = services.GetRequiredService<PhotoSetIndex>();
        foreach (var id in db.PhotoSets.Select(s => s.Id)) index.Add(id);
        services.GetRequiredService<CurrentImmichAccount>().Account = services.GetRequiredService<ImmichOptions>().Fake
            ? FakeImmich.Account
            : db.ImmichAccounts.AsNoTracking().SingleOrDefault();
    }

    public static void MapPhotos(this RouteGroupBuilder api)
    {
        var immich = api.MapGroup("/accounts/immich");

        immich.MapGet("/", (ImmichOptions options, CurrentImmichAccount current) => Info(options, current));

        // Checks the address and key with Immich before keeping them, then syncs every photo set with the new account.
        immich.MapPut("/", async (ImmichAccountChange body, ImmichOptions options, CurrentImmichAccount current, IImmich photos,
            PhotoSync sync, HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();

            Dictionary<string, string[]> errors = [];
            var address = AccountEndpoints.NormalizeAddress(body.Address);
            if (address is null) errors["address"] = ["Enter Immich's address, such as 192.168.1.20:2283 or https://photos.example.com."];
            var apiKey = string.IsNullOrWhiteSpace(body.ApiKey) ? current.Account?.ApiKey : body.ApiKey.Trim();
            if (apiKey is null) errors["apiKey"] = ["Enter an API key, made in Immich under Account Settings → API Keys."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var account = new ImmichAccount(address!, apiKey!);
            try
            {
                await photos.CheckAsync(account, ct);
            }
            catch (ImmichException e)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { [e.KeyRefused ? "apiKey" : "address"] = [e.Message] });
            }

            await db.ImmichAccounts.ExecuteDeleteAsync(ct);
            db.ImmichAccounts.Add(account);
            await db.SaveChangesAsync(ct);
            current.Account = account;
            _ = sync.SyncAllAsync(CancellationToken.None);
            return Info(options, current);
        });

        // Photo sets keep their list, but displays can't fetch their photos until Immich is set up again.
        immich.MapDelete("/", async (ImmichOptions options, CurrentImmichAccount current, HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            await db.ImmichAccounts.ExecuteDeleteAsync(ct);
            current.Account = null;
            return Results.NoContent();
        });

        // The albums photo sets can follow.
        immich.MapGet("/albums", async (CurrentImmichAccount current, IImmich photos, CancellationToken ct) =>
        {
            if (current.Account is not { } account) return NotSetUp();
            try
            {
                return Results.Ok(await photos.AlbumsAsync(account, ct));
            }
            catch (ImmichException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        // The people with a name, for a selection's rules.
        immich.MapGet("/people", async (CurrentImmichAccount current, IImmich photos, CancellationToken ct) =>
        {
            if (current.Account is not { } account) return NotSetUp();
            try
            {
                return Results.Ok(await photos.PeopleAsync(account, ct));
            }
            catch (ImmichException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        var sets = api.MapGroup("/photo-sets");

        sets.MapGet("/", (HomeyDashDbContext db, PhotoSync sync, CancellationToken ct) => ListAsync(db, sync, ct));

        // Syncs at once, so the set arrives with its photos.
        sets.MapPost("/", async (NewPhotoSet body, CurrentImmichAccount current, IImmich photos, [AsParameters] Services s, CancellationToken ct) =>
        {
            if (current.Account is not { } account) return NotSetUp();
            if (body.Selection is { } selection)
            {
                if (PhotoSet.ValidateName(body.Name) is { } nameError) return NameProblem(nameError);
                if (PhotoSelection.Validate(selection) is { } selectionError) return SelectionProblem(selectionError);
                var drawn = new PhotoSet { Name = body.Name!.Trim(), Selection = selection.Normalized() };
                s.Db.PhotoSets.Add(drawn);
                await s.Db.SaveChangesAsync(ct);
                s.Index.Add(drawn.Id);
                await s.Sync.SyncAsync(drawn.Id, ct);
                await s.Db.Entry(drawn).ReloadAsync(ct);
                await s.ChangedAsync(ct, dashboards: true);
                return Results.Created($"/api/photo-sets/{drawn.Id}", await ViewAsync(s.Db, s.Sync, drawn, ct));
            }
            if (string.IsNullOrWhiteSpace(body.AlbumId)) return AlbumProblem("Choose an Immich album.");
            ImmichAlbumContents? album;
            try
            {
                album = await photos.AlbumAsync(account, body.AlbumId, ct);
            }
            catch (ImmichException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
            if (album is null) return AlbumProblem("That album is not in Immich, or the API key cannot see it.");
            var name = string.IsNullOrWhiteSpace(body.Name) ? album.Name : body.Name;
            if (PhotoSet.ValidateName(name) is { } error) return NameProblem(error);

            var set = new PhotoSet
            {
                Name = name.Trim(), AlbumId = body.AlbumId, AlbumName = album.Name, Photos = album.Photos,
                SkippedVideos = album.SkippedVideos, SyncedAt = s.Time.GetUtcNow(),
            };
            s.Db.PhotoSets.Add(set);
            await s.Db.SaveChangesAsync(ct);
            s.Index.Add(set.Id);
            await s.ChangedAsync(ct, dashboards: true);
            return Results.Created($"/api/photo-sets/{set.Id}", await ViewAsync(s.Db, s.Sync, set, ct));
        });

        // A different album or selection syncs at once; a failed sync keeps the change and says why.
        sets.MapPatch("/{id:guid}", async (Guid id, PhotoSetChange body, [AsParameters] Services s, CancellationToken ct) =>
        {
            if (await s.Db.PhotoSets.FindAsync([id], ct) is not { } set) return Results.NotFound();
            if (body.Name is not null && PhotoSet.ValidateName(body.Name) is { } error) return NameProblem(error);
            if (body.AlbumId is not null && string.IsNullOrWhiteSpace(body.AlbumId)) return AlbumProblem("Choose an Immich album.");
            if (body.AlbumId is not null && body.Selection is not null) return AlbumProblem("Choose an album or rules, not both.");
            if (body.Selection is not null && PhotoSelection.Validate(body.Selection) is { } selectionError) return SelectionProblem(selectionError);

            if (body.Name is not null) set.Name = body.Name.Trim();
            var albumChanged = body.AlbumId is not null && body.AlbumId != set.AlbumId;
            var selection = body.Selection?.Normalized();
            var selectionChanged = selection is not null && !SameSelection(selection, set.Selection);
            if (albumChanged || selectionChanged)
            {
                set.AlbumId = selection is null ? body.AlbumId : null;
                set.Selection = selection;
                set.AlbumName = "";
                set.Photos = [];
                set.SyncedAt = null;
                set.SkippedVideos = 0;
            }
            await s.Db.SaveChangesAsync(ct);
            if (albumChanged || selectionChanged) await s.Sync.SyncAsync(id, ct);
            else await s.ChangedAsync(ct);
            await s.Db.Entry(set).ReloadAsync(ct);
            return Results.Ok(await ViewAsync(s.Db, s.Sync, set, ct));
        });

        // Tiles showing it become missing; Management flags their dashboards.
        sets.MapDelete("/{id:guid}", async (Guid id, [AsParameters] Services s, CancellationToken ct) =>
        {
            if (await s.Db.PhotoSets.FindAsync([id], ct) is not { } set) return Results.NotFound();
            s.Db.PhotoSets.Remove(set);
            await s.Db.SaveChangesAsync(ct);
            s.Index.Remove(id);
            s.Sync.Forget(id);
            await s.ChangedAsync(ct, dashboards: true);
            return Results.NoContent();
        });

        // Syncs with the album, or draws again, now rather than at the next round.
        sets.MapPost("/{id:guid}/sync", async (Guid id, [AsParameters] Services s, CancellationToken ct) =>
        {
            if (await s.Db.PhotoSets.AsNoTracking().FirstOrDefaultAsync(set => set.Id == id, ct) is null) return Results.NotFound();
            await s.Sync.SyncAsync(id, ct);
            var set = await s.Db.PhotoSets.AsNoTracking().FirstAsync(set => set.Id == id, ct);
            return Results.Ok(await ViewAsync(s.Db, s.Sync, set, ct));
        });

        // Fetched from Immich as a display asks for it; only photos of the set, so this can't reach the rest of Immich.
        api.MapGet("/photos/{setId:guid}/{photoId}", async (Guid setId, string photoId, HomeyDashDbContext db,
            CurrentImmichAccount current, IImmich photos, HttpContext http, CancellationToken ct) =>
        {
            var set = await db.PhotoSets.AsNoTracking().FirstOrDefaultAsync(s => s.Id == setId, ct);
            if (set?.Photos.Any(p => p.Id == photoId) != true) return Results.NotFound();
            if (current.Account is not { } account) return NotSetUp();
            ImmichPhoto? photo;
            try
            {
                photo = await photos.PhotoAsync(account, photoId, ct);
            }
            catch (ImmichException e)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
            }
            if (photo is null) return Results.NotFound();
            // Kept a day: tiles cycle through the same photos, and keep showing them while Immich can't be reached.
            http.Response.Headers.CacheControl = "public, max-age=86400";
            return Results.Stream(photo.Content, photo.ContentType);
        });
    }

    public sealed record Services(HomeyDashDbContext Db, PhotoSetIndex Index, PhotoSync Sync, RealtimeNotifier Notifier, TimeProvider Time)
    {
        public async Task ChangedAsync(CancellationToken ct, bool dashboards = false)
        {
            await Notifier.PhotoSetsChangedAsync(Db, ct);
            if (dashboards) await Notifier.DashboardsChangedAsync(Db, ct);
        }
    }

    public static async Task<List<PhotoSetView>> ListAsync(HomeyDashDbContext db, PhotoSync sync, CancellationToken ct)
    {
        var sets = await db.PhotoSets.AsNoTracking().ToListAsync(ct);
        var usage = await UsageAsync(db, ct);
        return sets.OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(s => View(s, sync, usage)).ToList();
    }

    private static async Task<PhotoSetView> ViewAsync(HomeyDashDbContext db, PhotoSync sync, PhotoSet set, CancellationToken ct) =>
        View(set, sync, await UsageAsync(db, ct));

    private static PhotoSetView View(PhotoSet set, PhotoSync sync, ILookup<string, string> usage) =>
        new(set.Id, set.Name, set.Target, set.AlbumId, set.AlbumName, set.Selection, set.Photos, set.SyncedAt, set.SkippedVideos,
            sync.Error(set.Id), usage[set.Target].Distinct().Order().ToList());

    // Which dashboards' drafts point at each target.
    private static async Task<ILookup<string, string>> UsageAsync(HomeyDashDbContext db, CancellationToken ct) =>
        (await db.Dashboards.AsNoTracking().ToListAsync(ct))
        .SelectMany(d => d.Targets().Select(target => (target, d.Name)))
        .ToLookup(x => x.target, x => x.Name);

    private static IResult Info(ImmichOptions options, CurrentImmichAccount current) =>
        Results.Ok(new ImmichAccountInfo(options.Fake, options.Fake ? null : current.Account?.Address));

    private static IResult NotSetUp() =>
        Results.Problem("Set up Immich under Accounts first.", statusCode: StatusCodes.Status409Conflict);

    private static IResult FakeProblem() =>
        Results.Problem("HomeyDash runs against a fake Immich, set in its configuration.", statusCode: StatusCodes.Status409Conflict);

    private static IResult NameProblem(string error) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [error] });

    // Records compare their lists by reference, so the people are compared one by one.
    private static bool SameSelection(PhotoSelection a, PhotoSelection? b) =>
        b is not null && a.Query == b.Query && a.Count == b.Count && a.RefreshHours == b.RefreshHours
        && a.With.Select(p => p.Id).SequenceEqual(b.With.Select(p => p.Id))
        && a.Without.Select(p => p.Id).SequenceEqual(b.Without.Select(p => p.Id));

    private static IResult SelectionProblem(string error) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["selection"] = [error] });

    private static IResult AlbumProblem(string error) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["albumId"] = [error] });
}
