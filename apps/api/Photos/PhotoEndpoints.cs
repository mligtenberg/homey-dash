using HomeyDash.Api.Accounts;
using HomeyDash.Api.Data;
using HomeyDash.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Photos;

// A photo set as the apps see it: Target is what a photo tile stores, Dashboards names those whose draft shows it.
// It has an AlbumId or a Selection. AccountId and AccountName are null once its Immich account is removed. SyncError
// says why the last sync with Immich failed; the photos are then those of the sync before.
public sealed record PhotoSetView(
    Guid Id, string Name, string Target, int? AccountId, string? AccountName, string? AlbumId, string AlbumName,
    PhotoSelection? Selection, IReadOnlyList<Photo> Photos, DateTimeOffset? SyncedAt, int SkippedVideos, string? SyncError,
    IReadOnlyList<string> Dashboards);

// An Immich account as Management sees it. Its key never leaves the backend.
public sealed record ImmichAccountInfo(int Id, string Name, string Address);

// Fake: the configuration runs HomeyDash against FakeImmich, whose one account can't be changed. Oldest first.
public sealed record ImmichAccountsInfo(bool Fake, IReadOnlyList<ImmichAccountInfo> Accounts);

public static class PhotoEndpoints
{
    // An album or a selection. Name may be left out to take the album's, AccountId to use the oldest Immich account.
    public sealed record NewPhotoSet(string? Name, string? AlbumId, PhotoSelection? Selection, int? AccountId = null);

    // Leaves out what stays the same. An album replaces a selection, and the other way round. Another account syncs
    // the album or selection with that account.
    public sealed record PhotoSetChange(string? Name, string? AlbumId, PhotoSelection? Selection, int? AccountId = null);

    // ApiKey may be left out of a change to keep the current key, such as when only the address changes.
    public sealed record ImmichAccountChange(string? Name, string? Address, string? ApiKey);

    public static IServiceCollection AddPhotos(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("Immich").Get<ImmichOptions>() ?? new ImmichOptions();
        services.AddSingleton(options);
        services.AddSingleton<ImmichAccounts>();
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

    // Reads which photo sets exist, before anything counts missing tiles, and the Immich accounts.
    public static void LoadPhotoSets(this IServiceProvider services)
    {
        var db = services.GetRequiredService<HomeyDashDbContext>();
        var index = services.GetRequiredService<PhotoSetIndex>();
        foreach (var id in db.PhotoSets.Select(s => s.Id)) index.Add(id);
        services.GetRequiredService<ImmichAccounts>().Set(services.GetRequiredService<ImmichOptions>().Fake
            ? [FakeImmich.Account]
            : db.ImmichAccounts.AsNoTracking().ToList());
    }

    public static void MapPhotos(this RouteGroupBuilder api)
    {
        var immich = api.MapGroup("/accounts/immich");

        immich.MapGet("/", (ImmichOptions options, ImmichAccounts accounts) => Info(options, accounts));

        // Checks the address and key with Immich before keeping them.
        immich.MapPost("/", async (ImmichAccountChange body, ImmichOptions options, ImmichAccounts accounts, IImmich photos,
            HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            var (account, problem) = await CheckAsync(body, null, accounts, photos, ct);
            if (account is null) return problem!;
            db.ImmichAccounts.Add(account);
            await db.SaveChangesAsync(ct);
            accounts.Set(await db.ImmichAccounts.AsNoTracking().ToListAsync(ct));
            return Info(options, accounts);
        });

        // A new address or key is checked with Immich first; the account's photo sets then sync with it.
        immich.MapPut("/{id:int}", async (int id, ImmichAccountChange body, ImmichOptions options, ImmichAccounts accounts,
            IImmich photos, PhotoSync sync, HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            if (await db.ImmichAccounts.FindAsync([id], ct) is not { } stored) return Results.NotFound();
            var (account, problem) = await CheckAsync(body, stored, accounts, photos, ct);
            if (account is null) return problem!;
            db.Entry(stored).State = EntityState.Detached;
            db.ImmichAccounts.Update(account);
            await db.SaveChangesAsync(ct);
            accounts.Set(await db.ImmichAccounts.AsNoTracking().ToListAsync(ct));
            if (account.Address != stored.Address || account.ApiKey != stored.ApiKey) _ = sync.SyncAllAsync(CancellationToken.None, force: false);
            else await sync.PushAsync();
            return Info(options, accounts);
        });

        // Its photo sets keep their photos, but displays can't fetch them until each set is given another account.
        immich.MapDelete("/{id:int}", async (int id, ImmichOptions options, ImmichAccounts accounts, PhotoSync sync,
            HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            if (await db.ImmichAccounts.FindAsync([id], ct) is not { } account) return Results.NotFound();
            db.ImmichAccounts.Remove(account);
            await db.SaveChangesAsync(ct);
            await db.PhotoSets.Where(s => s.AccountId == id).ExecuteUpdateAsync(u => u.SetProperty(s => s.AccountId, (int?)null), ct);
            accounts.Set(await db.ImmichAccounts.AsNoTracking().ToListAsync(ct));
            _ = sync.SyncAllAsync(CancellationToken.None, force: false);
            return Info(options, accounts);
        });

        // The albums photo sets can follow.
        immich.MapGet("/{id:int}/albums", (int id, ImmichAccounts accounts, IImmich photos, CancellationToken ct) =>
            AskAsync(accounts.Find(id), account => photos.AlbumsAsync(account, ct)));

        // The people with a name, for a selection's rules.
        immich.MapGet("/{id:int}/people", (int id, ImmichAccounts accounts, IImmich photos, CancellationToken ct) =>
            AskAsync(accounts.Find(id), account => photos.PeopleAsync(account, ct)));

        var sets = api.MapGroup("/photo-sets");

        sets.MapGet("/", (HomeyDashDbContext db, PhotoSync sync, ImmichAccounts accounts, CancellationToken ct) => ListAsync(db, sync, accounts, ct));

        // Syncs at once, so the set arrives with its photos.
        sets.MapPost("/", async (NewPhotoSet body, ImmichAccounts accounts, IImmich photos, [AsParameters] Services s, CancellationToken ct) =>
        {
            if (accounts.Default is null) return NotSetUp();
            if ((body.AccountId is null ? accounts.Default : accounts.Find(body.AccountId)) is not { } account)
                return AccountProblem("Choose one of the Immich accounts.");
            if (body.Selection is { } selection)
            {
                if (PhotoSet.ValidateName(body.Name) is { } nameError) return NameProblem(nameError);
                if (PhotoSelection.Validate(selection) is { } selectionError) return SelectionProblem(selectionError);
                var drawn = new PhotoSet { Name = body.Name!.Trim(), AccountId = account.Id, Selection = selection.Normalized() };
                s.Db.PhotoSets.Add(drawn);
                await s.Db.SaveChangesAsync(ct);
                s.Index.Add(drawn.Id);
                await s.Sync.SyncAsync(drawn.Id, ct);
                await s.Db.Entry(drawn).ReloadAsync(ct);
                await s.ChangedAsync(ct, dashboards: true);
                return Results.Created($"/api/photo-sets/{drawn.Id}", await ViewAsync(s, drawn, ct));
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
                Name = name.Trim(), AccountId = account.Id, AlbumId = body.AlbumId, AlbumName = album.Name, Photos = album.Photos,
                SkippedVideos = album.SkippedVideos, SyncedAt = s.Time.GetUtcNow(),
            };
            s.Db.PhotoSets.Add(set);
            await s.Db.SaveChangesAsync(ct);
            s.Index.Add(set.Id);
            await s.ChangedAsync(ct, dashboards: true);
            return Results.Created($"/api/photo-sets/{set.Id}", await ViewAsync(s, set, ct));
        });

        // A different album or selection syncs at once; a failed sync keeps the change and says why.
        sets.MapPatch("/{id:guid}", async (Guid id, PhotoSetChange body, ImmichAccounts accounts, [AsParameters] Services s, CancellationToken ct) =>
        {
            if (await s.Db.PhotoSets.FindAsync([id], ct) is not { } set) return Results.NotFound();
            if (body.AccountId is not null && accounts.Find(body.AccountId) is null) return AccountProblem("Choose one of the Immich accounts.");
            if (body.Name is not null && PhotoSet.ValidateName(body.Name) is { } error) return NameProblem(error);
            if (body.AlbumId is not null && string.IsNullOrWhiteSpace(body.AlbumId)) return AlbumProblem("Choose an Immich album.");
            if (body.AlbumId is not null && body.Selection is not null) return AlbumProblem("Choose an album or rules, not both.");
            if (body.Selection is not null && PhotoSelection.Validate(body.Selection) is { } selectionError) return SelectionProblem(selectionError);

            if (body.Name is not null) set.Name = body.Name.Trim();
            var albumChanged = body.AlbumId is not null && body.AlbumId != set.AlbumId;
            var selection = body.Selection?.Normalized();
            var selectionChanged = selection is not null && !SameSelection(selection, set.Selection);
            var accountChanged = body.AccountId is not null && body.AccountId != set.AccountId;
            if (accountChanged) set.AccountId = body.AccountId;
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
            if (albumChanged || selectionChanged || accountChanged) await s.Sync.SyncAsync(id, ct);
            else await s.ChangedAsync(ct);
            await s.Db.Entry(set).ReloadAsync(ct);
            return Results.Ok(await ViewAsync(s, set, ct));
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
            return Results.Ok(await ViewAsync(s, set, ct));
        });

        // Fetched from Immich as a display asks for it; only photos of the set, so this can't reach the rest of Immich.
        api.MapGet("/photos/{setId:guid}/{photoId}", async (Guid setId, string photoId, HomeyDashDbContext db,
            ImmichAccounts accounts, IImmich photos, HttpContext http, CancellationToken ct) =>
        {
            var set = await db.PhotoSets.AsNoTracking().FirstOrDefaultAsync(s => s.Id == setId, ct);
            if (set?.Photos.Any(p => p.Id == photoId) != true) return Results.NotFound();
            if (accounts.Find(set.AccountId) is not { } account) return NotSetUp();
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

    public sealed record Services(
        HomeyDashDbContext Db, PhotoSetIndex Index, PhotoSync Sync, ImmichAccounts Accounts, RealtimeNotifier Notifier, TimeProvider Time)
    {
        public async Task ChangedAsync(CancellationToken ct, bool dashboards = false)
        {
            await Notifier.PhotoSetsChangedAsync(Db, ct);
            if (dashboards) await Notifier.DashboardsChangedAsync(Db, ct);
        }
    }

    public static async Task<List<PhotoSetView>> ListAsync(HomeyDashDbContext db, PhotoSync sync, ImmichAccounts accounts, CancellationToken ct)
    {
        var sets = await db.PhotoSets.AsNoTracking().ToListAsync(ct);
        var usage = await UsageAsync(db, ct);
        return sets.OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(s => View(s, sync, accounts, usage)).ToList();
    }

    private static async Task<PhotoSetView> ViewAsync(Services s, PhotoSet set, CancellationToken ct) =>
        View(set, s.Sync, s.Accounts, await UsageAsync(s.Db, ct));

    private static PhotoSetView View(PhotoSet set, PhotoSync sync, ImmichAccounts accounts, ILookup<string, string> usage)
    {
        var account = accounts.Find(set.AccountId);
        return new(set.Id, set.Name, set.Target, account?.Id, account?.Name, set.AlbumId, set.AlbumName, set.Selection, set.Photos,
            set.SyncedAt, set.SkippedVideos, sync.Error(set.Id), usage[set.Target].Distinct().Order().ToList());
    }

    // Which dashboards' drafts point at each target.
    private static async Task<ILookup<string, string>> UsageAsync(HomeyDashDbContext db, CancellationToken ct) =>
        (await db.Dashboards.AsNoTracking().ToListAsync(ct))
        .SelectMany(d => d.Targets().Select(target => (target, d.Name)))
        .ToLookup(x => x.target, x => x.Name);

    private static IResult Info(ImmichOptions options, ImmichAccounts accounts) =>
        Results.Ok(new ImmichAccountsInfo(options.Fake, accounts.All.Select(a => new ImmichAccountInfo(a.Id, a.Name, a.Address)).ToList()));

    // The account as changed, or why not: a field left empty, or what Immich said. Stored is the account being changed,
    // null for a new one; Immich is only asked when its address or key changes.
    private static async Task<(ImmichAccount? Account, IResult? Problem)> CheckAsync(ImmichAccountChange body, ImmichAccount? stored, ImmichAccounts accounts,
        IImmich photos, CancellationToken ct)
    {
        Dictionary<string, string[]> errors = [];
        if (AccountEndpoints.ValidateName(body.Name, accounts.All.Where(a => a.Id != stored?.Id).Select(a => a.Name)) is { } nameError)
            errors["name"] = [nameError];
        var address = AccountEndpoints.NormalizeAddress(body.Address);
        if (address is null) errors["address"] = ["Enter Immich's address, such as 192.168.1.20:2283 or https://photos.example.com."];
        var apiKey = string.IsNullOrWhiteSpace(body.ApiKey) ? stored?.ApiKey : body.ApiKey.Trim();
        if (apiKey is null) errors["apiKey"] = ["Enter an API key, made in Immich under Account Settings → API Keys."];
        if (errors.Count > 0) return (null, Results.ValidationProblem(errors));

        var account = new ImmichAccount(address!, apiKey!) { Id = stored?.Id ?? 0, Name = body.Name!.Trim() };
        if (account.Address == stored?.Address && account.ApiKey == stored.ApiKey) return (account, null);
        try
        {
            await photos.CheckAsync(account, ct);
            return (account, null);
        }
        catch (ImmichException e)
        {
            return (null, Results.ValidationProblem(new Dictionary<string, string[]> { [e.KeyRefused ? "apiKey" : "address"] = [e.Message] }));
        }
    }

    // Asks the account's Immich, or says why it can't.
    private static async Task<IResult> AskAsync<T>(ImmichAccount? account, Func<ImmichAccount, Task<T>> ask)
    {
        if (account is null) return Results.NotFound();
        try
        {
            return Results.Ok(await ask(account));
        }
        catch (ImmichException e)
        {
            return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
        }
    }

    private static IResult AccountProblem(string error) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["accountId"] = [error] });

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
