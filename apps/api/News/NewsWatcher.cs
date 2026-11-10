using System.Collections.Concurrent;
using System.Text.Json;
using HomeyDash.Api.Data;
using HomeyDash.Api.Realtime;
using HomeyDash.Api.Rules;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.News;

/// <summary>
/// Keeps the latest stories of every news source in use (ADR-0016): the sources of the news tiles in every dashboard's draft
/// or published version, and of the news widgets on displays' lock screens. Reads each feed once every 10 minutes, however
/// many tiles show it, and not at all for a source nobody uses any more. Pushes every <see cref="NewsFeed"/> as <c>News</c>
/// when one changed. Displays never call a feed.
/// </summary>
public sealed class NewsWatcher(INewsFeeds feeds, IHubContext<RealtimeHub> hub, IServiceScopeFactory scopes, TimeProvider time,
    ILogger<NewsWatcher> logger) : BackgroundService
{
    // The tile kind whose settings.source it watches.
    public const string Kind = "news";

    public static TimeSpan Every { get; set; } = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan RetryEvery = TimeSpan.FromMinutes(2);
    // How often it looks whether a source came or went, or one is due.
    private static readonly TimeSpan LookEvery = TimeSpan.FromSeconds(30);

    private sealed class Watch
    {
        public DateTimeOffset At = DateTimeOffset.MinValue;
        public bool Failed;
        public volatile NewsFeed? Feed;
    }

    private readonly ConcurrentDictionary<string, Watch> _watches = new();
    private List<NewsSource> _lastUses = [];
    private readonly SemaphoreSlim _wake = new(0);

    // Every source in use, by id.
    public IReadOnlyList<NewsFeed> All => [.. _watches.OrderBy(w => w.Key, StringComparer.Ordinal).Select(w => w.Value.Feed ?? Loading(NewsSource.Find(w.Key)!))];

    // Looks again now, such as after a dashboard or lock screen changed and may have a new source.
    public void Wake() => _wake.Release();

    private static NewsFeed Loading(NewsSource source) => new(source.Id, source.Name, "loading", null, [], null);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                // Whatever goes wrong in one look, the watcher keeps looking: a dead background service stops the API.
                try
                {
                    await LookAsync(stoppingToken);
                }
                catch (Exception e) when (e is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
                {
                    logger.LogError(e, "Could not look at the news");
                }
                await _wake.WaitAsync(LookEvery, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task LookAsync(CancellationToken ct)
    {
        var changed = false;
        var used = (await UsesAsync(ct)).DistinctBy(s => s.Id).ToList();

        foreach (var id in _watches.Keys.Where(id => used.All(s => s.Id != id)))
            changed |= _watches.TryRemove(id, out _);

        foreach (var source in used)
        {
            var watch = _watches.GetOrAdd(source.Id, _ => new Watch());
            var fresh = await RefreshAsync(source, watch, ct);
            var before = watch.Feed;
            watch.Feed = fresh;
            changed |= before is null || JsonSerializer.Serialize(before) != JsonSerializer.Serialize(fresh);
        }
        if (changed) await SendAsync();
    }

    private async Task<NewsFeed> RefreshAsync(NewsSource source, Watch watch, CancellationToken ct)
    {
        var known = watch.Feed ?? Loading(source);
        var now = time.GetUtcNow();
        if (now - watch.At < (watch.Failed ? RetryEvery : Every) && known.Status is "connected" or "disconnected") return known;

        watch.At = now;
        try
        {
            var items = await feeds.ReadAsync(source, ct);
            watch.Failed = false;
            return new NewsFeed(source.Id, source.Name, "connected", null, items, now);
        }
        catch (NewsException e)
        {
            logger.LogWarning("No news from {Source}: {Error}", source.Name, e.Message);
            watch.Failed = true;
            return known with { Status = "disconnected", Error = e.Message };
        }
        // Anything else, such as a timeout or a bug, fails this source only, and is tried again like a feed refusing.
        catch (Exception e) when (e is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            logger.LogError(e, "No news from {Source}", source.Name);
            watch.Failed = true;
            return known with { Status = "disconnected", Error = $"Cannot reach {source.Name}." };
        }
    }

    // The sources of every news tile in a dashboard's draft or published version, logic tiles' included, and of every
    // display's lock screen widgets.
    private async Task<List<NewsSource>> UsesAsync(CancellationToken ct)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
            var dashboards = await db.Dashboards.AsNoTracking().ToListAsync(ct);
            var tiles = dashboards
                .SelectMany(d => d.Published is null ? [d.Draft] : new[] { d.Draft, d.Published })
                .SelectMany(layout => layout.Sections.SelectMany(s => s.Tiles))
                .SelectMany(t => t.Kind == LogicTiles.Kind ? LogicTiles.HeldTiles(t.Settings) : [(t.Kind, t.Settings)])
                .Where(t => t.Kind == Kind)
                .Select(t => NewsSource.Of(t.Settings))
                .OfType<NewsSource>();
            var widgets = (await db.Displays.AsNoTracking().ToListAsync(ct))
                .SelectMany(d => d.LockWidgets)
                .Where(w => w.Kind == Kind)
                .Select(w => NewsSource.Find(w.Source))
                .OfType<NewsSource>();
            return _lastUses = [.. tiles, .. widgets];
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Could not read the news sources in use");
            return _lastUses;
        }
    }

    private async Task SendAsync()
    {
        try
        {
            await hub.Clients.All.SendAsync("News", All);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Could not push the news");
        }
    }
}
