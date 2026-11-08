using System.Collections.Concurrent;
using System.Text.Json;
using HomeyDash.Api.Data;
using HomeyDash.Api.Realtime;
using HomeyDash.Api.Rules;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Traffic;

/// <summary>
/// Keeps the traffic of every route in use (ADR-0014): the routes of the traffic tiles in every dashboard's draft or
/// published version, and of the traffic widgets on displays' lock screens. Asks TomTom for each route once every 5 minutes,
/// however many tiles show it, and not at all for routes nobody uses any more. Pushes every <see cref="RouteTraffic"/> as
/// <c>Traffic</c> when one changed. Displays never call TomTom.
/// </summary>
public sealed class TrafficWatcher(TomTomAccounts accounts, ITraffic source, IHubContext<RealtimeHub> hub, IServiceScopeFactory scopes,
    TimeProvider time, ILogger<TrafficWatcher> logger) : BackgroundService
{
    public static TimeSpan Every { get; set; } = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan RetryEvery = TimeSpan.FromMinutes(2);
    // How often it looks whether a route came or went, or one is due.
    private static readonly TimeSpan LookEvery = TimeSpan.FromSeconds(30);

    private sealed class Watch
    {
        public DateTimeOffset At = DateTimeOffset.MinValue;
        public bool Failed;
        public volatile RouteTraffic? Result;
    }

    // Where a route is used, and the TomTom account it names (null: the oldest).
    private sealed record Use(TrafficRoute Route, int? Account);

    private readonly ConcurrentDictionary<string, Watch> _watches = new();
    private List<Use> _lastUses = [];
    private readonly SemaphoreSlim _wake = new(0);

    // Every route in use, by key.
    public IReadOnlyList<RouteTraffic> All => [.. _watches.OrderBy(w => w.Key, StringComparer.Ordinal).Select(w => w.Value.Result ?? Loading(w.Key))];

    // Looks again now, such as after a dashboard or lock screen changed and may have a new route.
    public void Wake() => _wake.Release();

    private static RouteTraffic Loading(string key) => new(key, "loading", null, null, null, null, null, null, null);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // A new or removed account changes what a route can do, so every route is asked again.
        void Changed()
        {
            foreach (var watch in _watches.Values) watch.At = DateTimeOffset.MinValue;
            Wake();
        }
        accounts.Changed += Changed;
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await LookAsync(stoppingToken);
                await _wake.WaitAsync(LookEvery, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        finally
        {
            accounts.Changed -= Changed;
        }
    }

    private async Task LookAsync(CancellationToken ct)
    {
        var changed = false;
        var uses = await UsesAsync(ct);
        var byKey = uses.GroupBy(u => u.Route.Key).ToDictionary(g => g.Key, g => g.ToList());

        foreach (var key in _watches.Keys.Where(key => !byKey.ContainsKey(key)))
            changed |= _watches.TryRemove(key, out _);

        foreach (var (key, routeUses) in byKey)
        {
            var watch = _watches.GetOrAdd(key, _ => new Watch());
            changed |= Set(watch, await RefreshAsync(key, routeUses, watch, ct));
        }
        if (changed) await SendAsync();
    }

    private static bool Set(Watch watch, RouteTraffic result)
    {
        var before = watch.Result;
        watch.Result = result;
        return before is null || JsonSerializer.Serialize(before) != JsonSerializer.Serialize(result);
    }

    private async Task<RouteTraffic> RefreshAsync(string key, List<Use> uses, Watch watch, CancellationToken ct)
    {
        var known = watch.Result ?? Loading(key);
        // The first use with an account that exists decides which one asks.
        var account = uses.Select(u => accounts.For(u.Account)).FirstOrDefault(a => a is not null);
        if (account is null)
        {
            watch.At = DateTimeOffset.MinValue;
            return Loading(key) with { Status = "noAccount" };
        }
        var now = time.GetUtcNow();
        if (now - watch.At < (watch.Failed ? RetryEvery : Every) && known.Status is "connected" or "disconnected") return known;

        watch.At = now;
        try
        {
            var fresh = await source.RouteAsync(account.ApiKey, uses[0].Route, ct);
            watch.Failed = false;
            return new RouteTraffic(key, "connected", null, fresh.TravelSeconds, fresh.UsualSeconds,
                Math.Max(0, fresh.TravelSeconds - fresh.UsualSeconds), fresh.DistanceMeters, fresh.Arrival, now);
        }
        catch (TrafficException e)
        {
            logger.LogWarning("No traffic for {Route}: {Error}", uses[0].Route.Name, e.Message);
            watch.Failed = true;
            return known with { Status = "disconnected", Error = e.Message };
        }
    }

    // The routes of every traffic tile in a dashboard's draft or published version, logic tiles' included, and of every
    // display's lock screen widgets.
    private async Task<List<Use>> UsesAsync(CancellationToken ct)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
            var dashboards = await db.Dashboards.AsNoTracking().ToListAsync(ct);
            var tiles = dashboards
                .SelectMany(d => d.Published is null ? [d.Draft] : new[] { d.Draft, d.Published })
                .SelectMany(layout => layout.Sections.SelectMany(s => s.Tiles))
                .SelectMany(t => t.Kind == LogicTiles.Kind ? LogicTiles.Held(t.Settings) : [t.Settings])
                .Select(settings => (Route: TrafficRoute.Of(settings), Account: AccountOf(settings)))
                .Where(u => u.Route is not null)
                .Select(u => new Use(u.Route!, u.Account));
            var widgets = (await db.Displays.AsNoTracking().ToListAsync(ct))
                .SelectMany(d => d.LockWidgets)
                .Where(w => w is { Kind: "traffic", Route: { IsValid: true } })
                .Select(w => new Use(w.Route!, w.Account));
            return _lastUses = [.. tiles, .. widgets];
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Could not read the traffic routes in use");
            return _lastUses;
        }
    }

    private static int? AccountOf(JsonElement settings) =>
        settings.ValueKind == JsonValueKind.Object && settings.TryGetProperty("account", out var a) && a.ValueKind == JsonValueKind.Number && a.TryGetInt32(out var id)
            ? id
            : null;

    private async Task SendAsync()
    {
        try
        {
            await hub.Clients.All.SendAsync("Traffic", All);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Could not push the traffic");
        }
    }
}
