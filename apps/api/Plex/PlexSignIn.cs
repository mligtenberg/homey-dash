using HomeyDash.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Plex;

// A sign-in under way: waiting for someone to approve it at AuthUrl, or failed with Error. AccountId is the account
// signed in again, null for a new one that will be called Name.
public sealed record PlexSignInStatus(string State, Uri? AuthUrl, string? Error, int? AccountId, string Name);

/// <summary>
/// Signing in with Plex for the home (ADR-0009): makes a pin on plex.tv, waits up to 15 minutes for someone to approve
/// it on Plex's own page, then keeps the account: a new one, or one signed in again, which keeps its id so its tiles
/// stay. An account with one server connects to it at once, and one signed in again to the server it had; otherwise
/// someone chooses in Management. Only the latest sign-in counts.
/// </summary>
public sealed class PlexSignIn(IPlex plex, PlexAccounts accounts, PlexOptions options, IServiceScopeFactory scopes, ILogger<PlexSignIn> logger)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan CheckEvery = TimeSpan.FromSeconds(2);

    private readonly Lock _lock = new();
    private CancellationTokenSource? _running;
    private volatile PlexSignInStatus? _status;

    public PlexSignInStatus? Status => _status;

    // Signs in a new account called name, or again the account with that id.
    public async Task<Uri> StartAsync(string name, int? accountId, CancellationToken ct)
    {
        Cancel();
        var existing = accounts.Find(accountId);
        // Plex ties the token to the client that asked for it, so signing in again keeps the identifier it had.
        var clientId = existing?.ClientId ?? Guid.NewGuid().ToString();
        var pin = await plex.CreatePinAsync(clientId, ct);
        var cancel = new CancellationTokenSource(Lifetime);
        lock (_lock) _running = cancel;
        _status = new PlexSignInStatus("waiting", pin.AuthUrl, null, existing?.Id, existing?.Name ?? name);
        _ = RunAsync(clientId, pin, existing?.Id, name, cancel);
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

    // Connects the account to the server, keeps it, and so starts watching it.
    public async Task<PlexAccount> UseServerAsync(PlexAccount account, PlexServerChoice server, CancellationToken ct)
    {
        var uri = await plex.ConnectAsync(account.ClientId, server, ct);
        // The server's own token is the signed-in profile's, so any other profile is left.
        return await SaveAsync(account with
        {
            ServerId = server.Id, ServerName = server.Name, ServerUri = uri, ServerToken = server.AccessToken, ProfileId = null, ProfileName = null,
        }, ct);
    }

    /// <summary>
    /// What the signed-in account's home has to choose from, and which it is using: the one chosen, else the one that signed in.
    /// </summary>
    public async Task<(IReadOnlyList<PlexProfile> Profiles, string? CurrentId)> ProfilesAsync(PlexAccount account, CancellationToken ct)
    {
        var profiles = await plex.ProfilesAsync(account.ClientId, account.Token, ct);
        var current = account.ProfileId
            ?? profiles.FirstOrDefault(p => string.Equals(p.Name, account.Username, StringComparison.OrdinalIgnoreCase))?.Id
            ?? profiles.FirstOrDefault(p => p.Admin)?.Id;
        return (profiles, current);
    }

    /// <summary>
    /// Uses the account's server as one of its home's profiles, so what is watched, resumed and listed as seen is that profile's.
    /// Anything the profile is not allowed fails with a <see cref="PlexException"/> and leaves the account as it was.
    /// </summary>
    public async Task<PlexAccount> UseProfileAsync(PlexAccount account, string profileId, string? pin, CancellationToken ct)
    {
        if (account.ServerId is null) throw new PlexException("Choose a server for this account first.");
        var profile = (await plex.ProfilesAsync(account.ClientId, account.Token, ct)).FirstOrDefault(p => p.Id == profileId)
            ?? throw new PlexException("That profile is not in the home.");
        var token = await plex.SwitchProfileAsync(account.ClientId, account.Token, profile.Id, pin, ct);
        var server = (await plex.ServersAsync(account.ClientId, token, ct)).FirstOrDefault(s => s.Id == account.ServerId)
            ?? throw new PlexException($"{profile.Name} can't use {account.ServerName}.");
        var uri = await plex.ConnectAsync(account.ClientId, server, ct);
        return await SaveAsync(account with { ServerUri = uri, ServerToken = server.AccessToken, ProfileId = profile.Id, ProfileName = profile.Name }, ct);
    }

    // Adds the account when it is new (Id 0), else changes it. Answers with it as kept.
    public async Task<PlexAccount> SaveAsync(PlexAccount account, CancellationToken ct)
    {
        if (options.Fake)
        {
            // The fake's one account lives in memory only.
            accounts.Set(accounts.All.Select(a => a.Id == account.Id ? account : a));
            return account;
        }
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
        db.PlexAccounts.Update(account);
        // EF gives a new account its id.
        await db.SaveChangesAsync(ct);
        accounts.Set(await db.PlexAccounts.AsNoTracking().ToListAsync(ct));
        return accounts.Find(account.Id) ?? account;
    }

    public async Task RemoveAsync(int id, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
        await db.PlexAccounts.Where(a => a.Id == id).ExecuteDeleteAsync(ct);
        accounts.Set(await db.PlexAccounts.AsNoTracking().ToListAsync(ct));
    }

    private async Task RunAsync(string clientId, PlexPin pin, int? accountId, string name, CancellationTokenSource cancel)
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
            var username = await plex.UsernameAsync(clientId, token, ct);
            // Removed while someone approved it: kept as a new account.
            var account = accounts.Find(accountId) is { } stored
                ? stored with { Token = token, Username = username }
                : new PlexAccount(clientId, token, username) { Name = name };
            var servers = await plex.ServersAsync(clientId, token, ct);
            var server = servers.FirstOrDefault(s => s.Id == account.ServerId) ?? (servers.Count == 1 ? servers[0] : null);
            if (server is not null) await UseServerAsync(account, server, ct);
            else await SaveAsync(account with { ServerId = null, ServerName = null, ServerUri = null, ServerToken = null, ProfileId = null, ProfileName = null }, ct);
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
        PlexSignInStatus? status;
        lock (_lock)
        {
            if (_running != cancel) return;
            _running = null;
            status = _status;
        }
        _status = error is null || status is null ? null : status with { State = "failed", AuthUrl = null, Error = error };
    }
}
