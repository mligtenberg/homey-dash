using System.Collections.Concurrent;
using HomeyDash.Api.Data;
using HomeyDash.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Photos;

/// <summary>
/// Keeps each photo set's list of photos in step with Immich (ADR-0008). A set that follows an album syncs when it is
/// made or changed, when someone asks, and every 15 minutes. A selection draws its photos when it is made or changed,
/// when someone asks, and then once its RefreshHours have passed. A sync that fails leaves the list as it was and keeps
/// why, until the next sync of that set works.
/// </summary>
public sealed class PhotoSync(
    IImmich immich, CurrentImmichAccount current, IServiceScopeFactory scopes, TimeProvider time, ILogger<PhotoSync> logger)
    : BackgroundService
{
    private static readonly TimeSpan Every = TimeSpan.FromMinutes(15);

    // One sync at a time, so a manual sync and the periodic one never write the same set at once.
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConcurrentDictionary<Guid, string> _errors = new();

    public string? Error(Guid setId) => _errors.GetValueOrDefault(setId);

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
            error = await TrySyncAsync(set, force, ct);
            changed = error is null && db.ChangeTracker.HasChanges();
            if (changed) await db.SaveChangesAsync(ct);
        }
        finally
        {
            _gate.Release();
        }

        var before = Error(setId);
        if (error is null) _errors.TryRemove(setId, out _);
        else _errors[setId] = error;
        if (changed || before != error) await PushAsync();
        return error;
    }

    // Selections only when they are due, unless force.
    public async Task SyncAllAsync(CancellationToken ct, bool force = false)
    {
        List<Guid> ids;
        using (var scope = scopes.CreateScope())
            ids = await scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>().PhotoSets.Select(s => s.Id).ToListAsync(ct);
        foreach (var id in ids) await SyncAsync(id, ct, force);
    }

    public void Forget(Guid setId) => _errors.TryRemove(setId, out _);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
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

    private async Task<string?> TrySyncAsync(PhotoSet set, bool force, CancellationToken ct)
    {
        if (current.Account is not { } account) return "Set up Immich under Accounts first.";
        try
        {
            if (set.Selection is { } selection)
            {
                if (!force && !selection.Due(set.SyncedAt, time.GetUtcNow())) return null;
                set.Photos = await immich.SelectAsync(account, selection, ct);
                set.SkippedVideos = 0;
                set.SyncedAt = time.GetUtcNow();
                return null;
            }
            if (set.AlbumId is null) return "Choose an Immich album, or rules to draw photos by.";
            if (await immich.AlbumAsync(account, set.AlbumId, ct) is not { } album)
                return "The album is no longer in Immich, or the API key cannot see it. Choose another album.";
            // A list of the same photos keeps its reference, so EF leaves the column alone.
            if (!set.Photos.SequenceEqual(album.Photos)) set.Photos = album.Photos;
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

    private async Task PushAsync()
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
