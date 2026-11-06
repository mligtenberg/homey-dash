using System.Collections.Concurrent;
using HomeyDash.Api.Data;
using HomeyDash.Api.Realtime;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.Plex;

/// <summary>
/// One Plex account as tiles see it: whether HomeyDash reaches its server, its libraries with their newest items, and
/// the players that played something since HomeyDash started. Every account's is pushed as <c>Plex</c>; what plays
/// now, on any of them, is pushed as <c>PlexSessions</c>.
/// </summary>
public sealed record PlexOverview(
    int AccountId, string AccountName, string Status, string? Error, bool Loaded, IReadOnlyList<PlexLibrary> Libraries,
    IReadOnlyList<PlexPlayer> Players);

// What a connection gets when it (re)connects: every account, oldest first, and what plays on any of them.
public sealed record PlexSnapshot(IReadOnlyList<PlexOverview> Accounts, IReadOnlyList<PlexSession> Sessions);

/// <summary>
/// Watches the server of every Plex account (ADR-0009): what plays every few seconds, and the libraries' newest items
/// every 10 minutes. Plex has no push that works across versions and players, so this polls. Sessions are pushed only
/// when something other than the steady progress of playing changed; tiles move progress on themselves.
/// </summary>
public sealed class PlexWatcher(
    IPlex plex, PlexAccounts accounts, IHubContext<RealtimeHub> hub, IServiceScopeFactory scopes, TimeProvider time,
    ILogger<PlexWatcher> logger) : BackgroundService
{
    public const int RecentCount = 24;

    private static readonly TimeSpan SessionsEvery = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan LibrariesEvery = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan RetryEvery = TimeSpan.FromSeconds(15);

    // Progress that drifts less than this from where tiles think it is goes unpushed.
    private const long DriftMs = 5_000;

    // Watching one account, for as long as it exists and keeps its sign-in and server.
    private sealed class Watch(PlexAccount account)
    {
        public volatile PlexAccount Account = account;
        public readonly CancellationTokenSource Stop = new();
        public readonly SemaphoreSlim Wake = new(0);
        public readonly ConcurrentDictionary<string, PlexPlayer> Players = new();
        public volatile PlexOverview Overview = Initial(account);
        public volatile IReadOnlyList<PlexSession> Sessions = [];
    }

    private readonly ConcurrentDictionary<int, Watch> _watches = new();
    private readonly SemaphoreSlim _accountsChanged = new(0);

    // Raised when an account, its players or what plays changed, beyond the steady progress of playing.
    public event Action? Changed;

    public IReadOnlyList<PlexOverview> Overviews =>
        accounts.All.Select(a => _watches.TryGetValue(a.Id, out var w) ? w.Overview : Initial(a)).ToList();

    // A tile's account (settings.account), or the oldest when it names none; null while there is no Plex account.
    public PlexOverview? Overview(int? accountId) =>
        accounts.For(accountId) is { } account ? _watches.TryGetValue(account.Id, out var w) ? w.Overview : Initial(account) : null;

    public IReadOnlyList<PlexSession> Sessions =>
        accounts.All.SelectMany(a => _watches.TryGetValue(a.Id, out var w) ? w.Sessions : []).ToList();

    public PlexSnapshot Snapshot => new(Overviews, Sessions);

    // Looks again now, such as after a command to one of the account's players.
    public void Wake(int accountId)
    {
        if (_watches.TryGetValue(accountId, out var watch)) watch.Wake.Release();
    }

    // Before the first look: loading, or waiting for someone to choose a server.
    private static PlexOverview Initial(PlexAccount account) =>
        new(account.Id, account.Name, account.Connection is null ? "choosingServer" : "connected", null, false, [], []);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        accounts.Changed += OnAccountsChanged;
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await ReconcileAsync(stoppingToken);
                await _accountsChanged.WaitAsync(stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        finally
        {
            accounts.Changed -= OnAccountsChanged;
            foreach (var watch in _watches.Values) watch.Stop.Cancel();
        }
    }

    private void OnAccountsChanged() => _accountsChanged.Release();

    // Watches new accounts and stops watching removed ones. An account signed in again or given another server starts
    // over; a new name only changes its overview.
    private async Task ReconcileAsync(CancellationToken stoppingToken)
    {
        var all = accounts.All;
        var changed = false;
        foreach (var (id, watch) in _watches)
        {
            if (all.Any(a => a.Id == id)) continue;
            watch.Stop.Cancel();
            _watches.TryRemove(id, out _);
            changed = true;
        }
        foreach (var account in all)
        {
            if (_watches.TryGetValue(account.Id, out var watch))
            {
                if (watch.Account == account) continue;
                if (watch.Account with { Name = account.Name } == account)
                {
                    watch.Account = account;
                    watch.Overview = watch.Overview with { AccountName = account.Name };
                    changed = true;
                    continue;
                }
                watch.Stop.Cancel();
            }
            var started = new Watch(account);
            _watches[account.Id] = started;
            _ = WatchAsync(started, stoppingToken);
            changed = true;
        }
        if (!changed) return;
        Changed?.Invoke();
        await SendAsync("Plex", Overviews);
        await SendAsync("PlexSessions", Sessions);
        await PushDashboardsAsync();
    }

    private async Task WatchAsync(Watch watch, CancellationToken stoppingToken)
    {
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, watch.Stop.Token);
        var ct = stop.Token;
        var librariesAt = DateTimeOffset.MinValue;
        while (!ct.IsCancellationRequested)
        {
            var account = watch.Account;
            var wait = SessionsEvery;
            try
            {
                if (account.Connection is not { } server)
                {
                    await SetOverviewAsync(watch, Initial(account));
                    wait = Timeout.InfiniteTimeSpan;
                }
                else
                {
                    var sessions = (await plex.SessionsAsync(server, ct)).Select(s => s with { AccountId = account.Id }).ToList();
                    foreach (var session in sessions) watch.Players[session.PlayerId] = new PlexPlayer(session.PlayerId, session.PlayerName);
                    var libraries = watch.Overview.Libraries;
                    if (time.GetUtcNow() - librariesAt >= LibrariesEvery || watch.Overview.Status != "connected" || !watch.Overview.Loaded)
                    {
                        libraries = await plex.LibrariesAsync(server, RecentCount, ct);
                        librariesAt = time.GetUtcNow();
                    }
                    await SetOverviewAsync(watch, new(account.Id, account.Name, "connected", null, true, libraries, Players(watch)));
                    await SetSessionsAsync(watch, sessions);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception e)
            {
                if (e is not PlexException) logger.LogWarning(e, "Watching Plex account {Account} failed", account.Name);
                // Libraries stay, so recently-added tiles keep their posters while the server is away.
                await SetOverviewAsync(watch, watch.Overview with
                {
                    AccountName = account.Name,
                    Status = "disconnected",
                    Error = e is PlexException ? e.Message : "Could not reach Plex.",
                });
                await SetSessionsAsync(watch, []);
                wait = RetryEvery;
            }

            try
            {
                await watch.Wake.WaitAsync(wait, ct);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private static List<PlexPlayer> Players(Watch watch) =>
        watch.Players.Values.OrderBy(p => p.Name, StringComparer.CurrentCultureIgnoreCase).ToList();

    private async Task SetOverviewAsync(Watch watch, PlexOverview overview)
    {
        var before = watch.Overview;
        if (before.AccountName == overview.AccountName && before.Status == overview.Status && before.Error == overview.Error
            && before.Loaded == overview.Loaded && before.Libraries.SequenceEqual(overview.Libraries, LibraryComparer.Instance)
            && before.Players.SequenceEqual(overview.Players))
            return;
        watch.Overview = overview;
        Changed?.Invoke();
        await SendAsync("Plex", Overviews);
        // Libraries coming or going change which tiles are missing.
        if (!before.Libraries.Select(l => l.Id).SequenceEqual(overview.Libraries.Select(l => l.Id)) || before.Loaded != overview.Loaded)
            await PushDashboardsAsync();
    }

    private async Task SetSessionsAsync(Watch watch, IReadOnlyList<PlexSession> sessions)
    {
        var before = watch.Sessions;
        watch.Sessions = sessions;
        if (!Differs(before, sessions)) return;
        Changed?.Invoke();
        await SendAsync("PlexSessions", Sessions);
    }

    // Anything but progress that moves on as tiles expect.
    private static bool Differs(IReadOnlyList<PlexSession> before, IReadOnlyList<PlexSession> after) =>
        before.Count != after.Count || before.Zip(after).Any(pair =>
        {
            var (a, b) = pair;
            if (a with { OffsetMs = 0, At = default } != b with { OffsetMs = 0, At = default }) return true;
            var expected = a.OffsetMs + (a.State == "playing" ? (long)(b.At - a.At).TotalMilliseconds : 0);
            return Math.Abs(expected - b.OffsetMs) > DriftMs;
        });

    private async Task SendAsync(string message, object payload)
    {
        try
        {
            await hub.Clients.All.SendAsync(message, payload);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Could not push {Message}", message);
        }
    }

    private async Task PushDashboardsAsync()
    {
        try
        {
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<RealtimeNotifier>()
                .DashboardsChangedAsync(scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>(), CancellationToken.None);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Could not push the dashboards");
        }
    }

    // Records compare their lists by reference, so a library's items are compared one by one.
    private sealed class LibraryComparer : IEqualityComparer<PlexLibrary>
    {
        public static readonly LibraryComparer Instance = new();

        public bool Equals(PlexLibrary? a, PlexLibrary? b) =>
            a is not null && b is not null && a.Id == b.Id && a.Title == b.Title && a.Type == b.Type && a.Count == b.Count && a.Recent.SequenceEqual(b.Recent) && a.Titles.SequenceEqual(b.Titles);

        public int GetHashCode(PlexLibrary library) => library.Id.GetHashCode();
    }
}
