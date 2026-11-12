using System.Collections.Concurrent;
using System.Threading.Channels;
using HomeyDash.Api.Data;
using HomeyDash.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Photos;

/// <summary>
/// Keeps each photo set's list of photos in step with Immich (ADR-0008). A set that follows an album syncs when it is
/// made or changed, when someone asks, and every 15 minutes. A selection draws its photos when it is made or changed,
/// when someone asks, and then once its RefreshHours have passed. A sync that fails leaves the list as it was and keeps
/// why, until the next sync of that set works. After a sync, the faces in each new photo are read in the background, so
/// a tile can crop the photo around them; a photo keeps its faces from one sync to the next, until it is edited in
/// Immich. A photo excluded from the set never comes back with a sync. A sync someone asks for runs in the background,
/// since drawing many photos can take a while; Syncing says it has not finished. A selection's photos come in as they
/// are drawn, saved and pushed every second, and go back to those from before when the draw fails part way. Every round
/// first asks Immich who shares photos with each account, so a display knows which partners' photos it can't rotate.
/// </summary>
public sealed class PhotoSync(
    IImmich immich, ImmichAccounts accounts, ImmichOptions options, IServiceScopeFactory scopes, TimeProvider time, ILogger<PhotoSync> logger)
    : BackgroundService
{
    private static readonly TimeSpan Every = TimeSpan.FromMinutes(15);

    // How often the photos drawn so far are saved and pushed while a selection draws.
    private static readonly TimeSpan ShowEvery = TimeSpan.FromSeconds(1);

    // Photos whose faces are read at once.
    private const int FaceReaders = 8;

    // One sync at a time, so a manual sync and the periodic one never write the same set at once.
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConcurrentDictionary<Guid, string> _errors = new();
    private readonly ConcurrentDictionary<Guid, byte> _syncing = new();

    // Set when some photos may not have had their faces read; one pass reads them all.
    private readonly Channel<bool> _facesWanted =
        Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });

    public string? Error(Guid setId) => _errors.GetValueOrDefault(setId);

    // The sets syncing now. Taken before the sets are read, so a set read after its sync finished is never taken for one
    // still syncing, nor one read before for one done.
    public IReadOnlySet<Guid> Syncing() => _syncing.Keys.ToHashSet();

    // Syncs in the background, telling every connection when it is done. A set already syncing is left to that sync.
    public void Start(Guid setId, bool force = true)
    {
        if (!_syncing.TryAdd(setId, 0)) return;
        _ = Task.Run(async () =>
        {
            try
            {
                await SyncAsync(setId, CancellationToken.None, force);
            }
            catch (Exception e)
            {
                logger.LogWarning(e, "Syncing photo set {SetId} failed", setId);
            }
            finally
            {
                _syncing.TryRemove(setId, out _);
            }
            await PushAsync();
        });
    }

    // Resolves to why the sync failed, or null. Force draws a selection again even when it is not due.
    public async Task<string?> SyncAsync(Guid setId, CancellationToken ct, bool force = true)
    {
        await _gate.WaitAsync(ct);
        string? error;
        bool changed;
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
            if (await db.PhotoSets.FindAsync([setId], ct) is not { } set) return null;
            error = await TrySyncAsync(set, force, async () =>
            {
                await db.SaveChangesAsync(ct);
                await PushAsync();
            }, ct);
            // Also when it failed, to put back the photos from before what was drawn so far.
            changed = db.ChangeTracker.HasChanges();
            if (changed) await db.SaveChangesAsync(ct);
        }
        finally
        {
            _gate.Release();
        }

        var before = Error(setId);
        if (error is null) _errors.TryRemove(setId, out _);
        else _errors[setId] = error;
        if (changed) WantFaces();
        if (changed || before != error) await PushAsync();
        return error;
    }

    // Selections only when they are due, unless force.
    public async Task SyncAllAsync(CancellationToken ct, bool force = false)
    {
        foreach (var account in accounts.All)
        {
            try
            {
                await PartnersAsync(account, ct);
            }
            catch (ImmichException e)
            {
                logger.LogInformation("Could not ask Immich who shares photos with {Account}: {Reason}", account.Name, e.Message);
            }
        }
        List<Guid> ids;
        using (var scope = scopes.CreateScope())
            ids = await scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>().PhotoSets.Select(s => s.Id).ToListAsync(ct);
        foreach (var id in ids) await SyncAsync(id, ct, force);
    }

    public void Forget(Guid setId) => _errors.TryRemove(setId, out _);

    // Has the faces read in the background in every photo that has not had them read.
    public void WantFaces() => _facesWanted.Writer.TryWrite(true);

    // Reads, set by set, the faces in each photo that has not had them read. Reading stops for a set when Immich
    // refuses, such as a key without face.read, keeping what it read; the rest are read at the next pass.
    public async Task ReadFacesAsync(CancellationToken ct)
    {
        List<(Guid Id, int? AccountId, string[] PhotoIds)> unread;
        using (var scope = scopes.CreateScope())
            unread = (await scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>().PhotoSets.AsNoTracking().ToListAsync(ct))
                .Select(s => (s.Id, s.AccountId, PhotoIds: s.Photos.Where(p => p.FacesUnread).Select(p => p.Id).Distinct().ToArray()))
                .Where(s => s.PhotoIds.Length > 0)
                .ToList();
        foreach (var set in unread)
        {
            if (accounts.Find(set.AccountId) is not { } account) continue;
            ConcurrentDictionary<string, Faces> read = new();
            try
            {
                await Parallel.ForEachAsync(set.PhotoIds, new ParallelOptions { MaxDegreeOfParallelism = FaceReaders, CancellationToken = ct },
                    async (id, token) => read[id] = await immich.FacesAsync(account, id, token) ?? Faces.None);
            }
            catch (Exception e) when (!ct.IsCancellationRequested)
            {
                logger.LogWarning("Could not read the faces in photo set {SetId}: {Reason}", set.Id, e.Message);
            }
            if (!read.IsEmpty && await SaveFacesAsync(set.Id, read, ct)) await PushAsync();
        }
    }

    // Under the gate, onto the set as it is now, since it may have synced while its faces were read.
    private async Task<bool> SaveFacesAsync(Guid setId, IReadOnlyDictionary<string, Faces> read, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
            if (await db.PhotoSets.FindAsync([setId], ct) is not { } set) return false;
            set.Photos = set.Photos.Select(p => p.FacesUnread && read.TryGetValue(p.Id, out var faces) ? p with { Faces = faces } : p).ToList();
            await db.SaveChangesAsync(ct);
            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    // After the photo was edited in Immich, such as rotated: every set of the account with it takes its new version, and
    // has its faces read again, since they moved with it.
    public async Task EditedAsync(int accountId, string photoId, string? version, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
            foreach (var set in await db.PhotoSets.Where(s => s.AccountId == accountId).ToListAsync(ct))
                if (set.Photos.Any(p => p.Id == photoId))
                    set.Photos = set.Photos.Select(p => p.Id == photoId ? p with { Version = version, Faces = null } : p).ToList();
            await db.SaveChangesAsync(ct);
        }
        finally
        {
            _gate.Release();
        }
        WantFaces();
        await PushAsync();
    }

    // A photo that was in the set before keeps the faces read in it, unless it was edited in Immich since. One from before
    // HomeyDash knew versions keeps them too.
    private static List<Photo> KeepFaces(IEnumerable<Photo> photos, IEnumerable<Photo> before)
    {
        Dictionary<string, Photo> read = [];
        foreach (var photo in before)
            if (photo.Faces is not null) read.TryAdd(photo.Id, photo);
        return photos.Select(p => p.Faces is null && read.TryGetValue(p.Id, out var old) && (old.Version is null || old.Version == p.Version)
            ? p with { Faces = old.Faces } : p).ToList();
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Task.WhenAll(SyncLoopAsync(stoppingToken), FacesLoopAsync(stoppingToken));

    private async Task FacesLoopAsync(CancellationToken stoppingToken)
    {
        // Sets synced before HomeyDash read faces, or while it was stopped.
        WantFaces();
        try
        {
            await foreach (var _ in _facesWanted.Reader.ReadAllAsync(stoppingToken))
            {
                try
                {
                    await ReadFacesAsync(stoppingToken);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogWarning(e, "Reading the faces in the photo sets failed");
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task SyncLoopAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SyncAllAsync(stoppingToken);
                await Task.Delay(Every, time, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception e)
            {
                logger.LogWarning(e, "Syncing the photo sets failed");
                await Task.Delay(Every, time, stoppingToken);
            }
        }
    }

    // Show saves and pushes the photos drawn so far.
    private async Task<string?> TrySyncAsync(PhotoSet set, bool force, Func<Task> show, CancellationToken ct)
    {
        if (accounts.Find(set.AccountId) is not { } account)
            return accounts.All.Count == 0 ? "Set up Immich under Accounts first." : "Its Immich account was removed. Choose another account for it.";
        try
        {
            if (set.Selection is { } selection)
            {
                if (!force && !selection.Due(set.SyncedAt, time.GetUtcNow())) return null;
                var before = set.Photos;
                List<Photo> drawn = [];
                var shown = time.GetTimestamp();
                try
                {
                    // As many more as are excluded, so leaving those out still makes the count where Immich has enough.
                    await foreach (var photo in immich.DrawAsync(account, selection with { Count = selection.Count + set.Excluded.Count }, ct))
                    {
                        if (set.Excluded.Contains(photo.Id)) continue;
                        drawn.Add(photo);
                        if (drawn.Count == selection.Count) break;
                        if (drawn.Count > 1 && time.GetElapsedTime(shown) < ShowEvery) continue;
                        set.Photos = KeepFaces(drawn, before);
                        await show();
                        shown = time.GetTimestamp();
                    }
                }
                catch
                {
                    set.Photos = before;
                    throw;
                }
                set.Photos = KeepFaces(drawn, before);
                set.SkippedVideos = 0;
                set.SyncedAt = time.GetUtcNow();
                return null;
            }
            if (set.AlbumId is null) return "Choose an Immich album, or rules to draw photos by.";
            if (await immich.AlbumAsync(account, set.AlbumId, ct) is not { } album)
                return "The album is no longer in Immich, or the API key cannot see it. Choose another album.";
            // A list of the same photos keeps its reference, so EF leaves the column alone.
            var photos = KeepFaces(set.Keep(album.Photos), set.Photos);
            if (!set.Photos.SequenceEqual(photos)) set.Photos = photos;
            set.AlbumName = album.Name;
            set.SkippedVideos = album.SkippedVideos;
            set.SyncedAt = time.GetUtcNow();
            return null;
        }
        catch (ImmichException e)
        {
            return e.Message;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Syncing photo set {SetId} failed", set.Id);
            return "Syncing with Immich failed. Try again.";
        }
    }

    // Who shares their photos with the account, as Immich says now, with the keys they were given. Those who no longer
    // share are forgotten, with their keys.
    public async Task<IReadOnlyList<ImmichPartner>> PartnersAsync(ImmichAccount account, CancellationToken ct)
    {
        var users = await immich.PartnersAsync(account, ct);
        List<ImmichPartner> partners = [.. users.Select(u => new ImmichPartner(u.Id, u.Name, account.Partners.FirstOrDefault(p => p.Id == u.Id)?.ApiKey))];
        if (!partners.SequenceEqual(account.Partners)) await SaveAsync(account with { Partners = partners }, ct);
        return partners;
    }

    // In the database, or only in memory for the fake's account. Photo sets are pushed, since which photos can be rotated
    // may have changed.
    public async Task SaveAsync(ImmichAccount account, CancellationToken ct)
    {
        if (options.Fake)
        {
            accounts.Set(accounts.All.Select(a => a.Id == account.Id ? account : a));
        }
        else
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
            db.ImmichAccounts.Update(account);
            await db.SaveChangesAsync(ct);
            accounts.Set(await db.ImmichAccounts.AsNoTracking().ToListAsync(ct));
        }
        await PushAsync();
    }

    // Tells every connection the photo sets changed, such as when their account is renamed.
    public async Task PushAsync()
    {
        try
        {
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<RealtimeNotifier>()
                .PhotoSetsChangedAsync(scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>(), CancellationToken.None);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Could not push the photo sets");
        }
    }
}
