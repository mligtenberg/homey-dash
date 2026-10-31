using HomeyDash.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Plex;

// A sign-in under way: waiting for someone to approve it at AuthUrl, or failed with Error.
public sealed record PlexSignInStatus(string State, Uri? AuthUrl, string? Error);

/// <summary>
/// Signing in with Plex for the home (ADR-0009): makes a pin on plex.tv, waits up to 15 minutes for someone to approve
/// it on Plex's own page, then keeps the account. An account with one server connects to it at once; with several,
/// someone chooses in Management. Only the latest sign-in counts.
/// </summary>
public sealed class PlexSignIn(
    IPlex plex, CurrentPlexAccount current, PlexWatcher watcher, IServiceScopeFactory scopes, ILogger<PlexSignIn> logger)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan CheckEvery = TimeSpan.FromSeconds(2);

    private readonly Lock _lock = new();
    private CancellationTokenSource? _running;
    private volatile PlexSignInStatus? _status;

    public PlexSignInStatus? Status => _status;

    public async Task<Uri> StartAsync(CancellationToken ct)
    {
        Cancel();
        // Plex ties the token to the client that asked for it, so a new sign-in keeps the identifier it had.
        var clientId = current.Account?.ClientId ?? Guid.NewGuid().ToString();
        var pin = await plex.CreatePinAsync(clientId, ct);
        var cancel = new CancellationTokenSource(Lifetime);
        lock (_lock) _running = cancel;
        _status = new PlexSignInStatus("waiting", pin.AuthUrl, null);
        _ = RunAsync(clientId, pin, cancel);
        return pin.AuthUrl;
    }

    public void Cancel()
    {
        lock (_lock)
        {
            _running?.Cancel();
            _running = null;
        }
        _status = null;
    }

    // Connects the account to the server, keeps it, and starts watching it.
    public async Task<PlexAccount> UseServerAsync(PlexAccount account, PlexServerChoice server, CancellationToken ct)
    {
        var uri = await plex.ConnectAsync(account.ClientId, server, ct);
        var connected = account with { ServerId = server.Id, ServerName = server.Name, ServerUri = uri, ServerToken = server.AccessToken };
        await SaveAsync(connected, ct);
        return connected;
    }

    public async Task SaveAsync(PlexAccount? account, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
        await db.PlexAccounts.ExecuteDeleteAsync(ct);
        if (account is not null)
        {
            db.PlexAccounts.Add(account);
            await db.SaveChangesAsync(ct);
        }
        current.Account = account;
        watcher.Wake();
    }

    private async Task RunAsync(string clientId, PlexPin pin, CancellationTokenSource cancel)
    {
        var ct = cancel.Token;
        try
        {
            string? token = null;
            while (token is null)
            {
                await Task.Delay(CheckEvery, ct);
                token = await plex.CheckPinAsync(clientId, pin.Id, ct);
            }
            var account = new PlexAccount(clientId, token, await plex.UsernameAsync(clientId, token, ct));
            var servers = await plex.ServersAsync(clientId, token, ct);
            if (servers.Count == 1) await UseServerAsync(account, servers[0], ct);
            else await SaveAsync(account, ct);
            Finish(cancel, null);
        }
        catch (OperationCanceledException)
        {
            Finish(cancel, cancel.IsCancellationRequested && _running == cancel ? "Nobody approved the sign-in in time. Sign in again." : null);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Signing in with Plex failed");
            Finish(cancel, e is PlexException ? e.Message : "Signing in with Plex failed. Try again.");
        }
    }

    // Only the latest sign-in reports back.
    private void Finish(CancellationTokenSource cancel, string? error)
    {
        lock (_lock)
        {
            if (_running != cancel) return;
            _running = null;
        }
        _status = error is null ? null : new PlexSignInStatus("failed", null, error);
    }
}
