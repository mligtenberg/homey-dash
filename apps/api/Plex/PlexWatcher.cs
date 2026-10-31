using System.Collections.Concurrent;
using HomeyDash.Api.Data;
using HomeyDash.Api.Realtime;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.Plex;

/// <summary>
/// Plex as tiles see it: whether HomeyDash reaches the server, its libraries with their newest items, and the players
/// that played something since HomeyDash started. Pushed as <c>Plex</c>; what plays now is pushed as <c>PlexSessions</c>.
/// </summary>
public sealed record PlexOverview(string Status, string? Error, bool Loaded, IReadOnlyList<PlexLibrary> Libraries, IReadOnlyList<PlexPlayer> Players);

// What a connection gets when it (re)connects.
public sealed record PlexSnapshot(PlexOverview Overview, IReadOnlyList<PlexSession> Sessions);

/// <summary>
/// Watches the Plex server (ADR-0009): what plays every few seconds, and the libraries' newest items every 10 minutes.
/// Plex has no push that works across versions and players, so this polls. Sessions are pushed only when something
/// other than the steady progress of playing changed; tiles move progress on themselves.
/// </summary>
public sealed class PlexWatcher(
    IPlex plex, CurrentPlexAccount current, IHubContext<RealtimeHub> hub, IServiceScopeFactory scopes, TimeProvider time,
    ILogger<PlexWatcher> logger) : BackgroundService
{
    public const int RecentCount = 24;

    private static readonly TimeSpan SessionsEvery = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan LibrariesEvery = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan RetryEvery = TimeSpan.FromSeconds(15);

    // Progress that drifts less than this from where tiles think it is goes unpushed.
    private const long DriftMs = 5_000;

    private readonly SemaphoreSlim _wake = new(0);
    private readonly ConcurrentDictionary<string, PlexPlayer> _players = new();
    private volatile PlexOverview _overview = new("notSetUp", null, false, [], []);
    private volatile IReadOnlyList<PlexSession> _sessions = [];

    public PlexOverview Overview => _overview;
    public IReadOnlyList<PlexSession> Sessions => _sessions;
    public PlexSnapshot Snapshot => new(_overview, _sessions);

    // Looks again now, such as after a command to a player or a new account.
    public void Wake() => _wake.Release();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        PlexAccount? watching = null;
        var librariesAt = DateTimeOffset.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            var account = current.Account;
            var wait = SessionsEvery;
            try
            {
                if (!ReferenceEquals(account, watching))
                {
                    watching = account;
                    librariesAt = DateTimeOffset.MinValue;
                    _players.Clear();
                    await SetSessionsAsync([], force: true);
                }
                if (account?.Connection is not { } server)
                {
                    await SetOverviewAsync(new(account is null ? "notSetUp" : "choosingServer", null, false, [], []));
                    wait = Timeout.InfiniteTimeSpan;
                }
                else
                {
                    var sessions = await plex.SessionsAsync(server, stoppingToken);
                    foreach (var session in sessions) _players[session.PlayerId] = new PlexPlayer(session.PlayerId, session.PlayerName);
                    var libraries = _overview.Libraries;
                    if (time.GetUtcNow() - librariesAt >= LibrariesEvery || _overview.Status != "connected")
                    {
                        libraries = await plex.LibrariesAsync(server, RecentCount, stoppingToken);
                        librariesAt = time.GetUtcNow();
                    }
                    await SetOverviewAsync(new("connected", null, true, libraries, Players()));
                    await SetSessionsAsync(sessions);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception e)
            {
                if (e is not PlexException) logger.LogWarning(e, "Watching Plex failed");
                // Libraries stay, so recently-added tiles keep their posters while the server is away.
                await SetOverviewAsync(_overview with
                {
                    Status = "disconnected",
                    Error = e is PlexException ? e.Message : "Could not reach Plex.",
                });
                await SetSessionsAsync([]);
                wait = RetryEvery;
            }

            try
            {
                await _wake.WaitAsync(wait, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private List<PlexPlayer> Players() => _players.Values.OrderBy(p => p.Name, StringComparer.CurrentCultureIgnoreCase).ToList();

    private async Task SetOverviewAsync(PlexOverview overview)
    {
        var before = _overview;
        if (before.Status == overview.Status && before.Error == overview.Error && before.Loaded == overview.Loaded
            && before.Libraries.SequenceEqual(overview.Libraries, LibraryComparer.Instance) && before.Players.SequenceEqual(overview.Players))
            return;
        _overview = overview;
        await SendAsync("Plex", overview);
        // Libraries coming or going change which tiles are missing.
        if (!before.Libraries.Select(l => l.Id).SequenceEqual(overview.Libraries.Select(l => l.Id)) || before.Loaded != overview.Loaded)
            await PushDashboardsAsync();
    }

    private async Task SetSessionsAsync(IReadOnlyList<PlexSession> sessions, bool force = false)
    {
        var before = _sessions;
        _sessions = sessions;
        if (force || Differs(before, sessions)) await SendAsync("PlexSessions", sessions);
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
            a is not null && b is not null && a.Id == b.Id && a.Title == b.Title && a.Type == b.Type && a.Recent.SequenceEqual(b.Recent);

        public int GetHashCode(PlexLibrary library) => library.Id.GetHashCode();
    }
}
