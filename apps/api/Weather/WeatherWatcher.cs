using System.Collections.Concurrent;
using System.Text.Json;
using HomeyDash.Api.Data;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Realtime;
using HomeyDash.Api.Rules;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Weather;

/// <summary>
/// Keeps the weather where each Homey is, and at each place a weather tile chose (ADR-0013): Open-Meteo's forecast every
/// 15 minutes and Buienradar's rain every 5. Places come from the dashboards' drafts and published versions, so a place
/// chosen in the editor shows at once. Pushes every <see cref="Forecast"/> as <c>Forecasts</c> when one changed.
/// Displays never call either service.
/// </summary>
public sealed class WeatherWatcher(Homeys homeys, IWeatherSource source, IHubContext<RealtimeHub> hub, IServiceScopeFactory scopes,
    TimeProvider time, ILogger<WeatherWatcher> logger) : BackgroundService
{
    public static TimeSpan ForecastEvery { get; set; } = TimeSpan.FromMinutes(15);
    public static TimeSpan RainEvery { get; set; } = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan RetryEvery = TimeSpan.FromMinutes(2);
    // How often it looks whether a Homey told where it is, a place came or went, or a forecast is due.
    private static readonly TimeSpan LookEvery = TimeSpan.FromSeconds(30);

    private sealed class Watch
    {
        public HomeyLocation? Location;
        public DateTimeOffset ForecastAt = DateTimeOffset.MinValue;
        public DateTimeOffset RainAt = DateTimeOffset.MinValue;
        public bool Failed;
        public volatile Forecast? Forecast;
    }

    private readonly ConcurrentDictionary<int, Watch> _homeys = new();
    private readonly ConcurrentDictionary<string, (WeatherPlace Place, Watch Watch)> _places = new();
    private readonly SemaphoreSlim _wake = new(0);

    // Every Homey's, oldest account first, then every place's.
    public IReadOnlyList<Forecast> All =>
        [.. homeys.All.Select(Current), .. _places.Values.Select(p => p.Watch.Forecast ?? Empty(p.Place)).OrderBy(f => f.PlaceKey, StringComparer.Ordinal)];

    // A tile's account (settings.account), or the oldest when it names none; null while there is no such Homey.
    public Forecast? For(int? accountId) => homeys.For(accountId) is { } entry ? Current(entry) : null;

    // Looks again now, such as after a dashboard changed and may have a new place.
    public void Wake() => _wake.Release();

    private Forecast Current(Homeys.Entry entry) =>
        _homeys.TryGetValue(entry.AccountId, out var w) && w.Forecast is { } forecast
            ? forecast with { AccountName = entry.Name }
            : Empty(entry, "loading");

    private static Forecast Empty(Homeys.Entry entry, string status) =>
        new(entry.AccountId, entry.Name, null, status, null, entry.State.Weather?.City, null, [], [], null, null);

    private static Forecast Empty(WeatherPlace place) => new(null, null, place.Key, "loading", null, place.Name, null, [], [], null, null);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        homeys.Changed += Wake;
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
            homeys.Changed -= Wake;
        }
    }

    private async Task LookAsync(CancellationToken ct)
    {
        var changed = false;

        var all = homeys.All;
        foreach (var id in _homeys.Keys.Where(id => all.All(e => e.AccountId != id)))
            changed |= _homeys.TryRemove(id, out _);
        foreach (var entry in all)
        {
            var watch = _homeys.GetOrAdd(entry.AccountId, _ => new Watch());
            changed |= Set(watch, await UpdateHomeyAsync(entry, watch, ct));
        }

        var places = await PlacesAsync(ct);
        foreach (var key in _places.Keys.Where(key => !places.ContainsKey(key)))
            changed |= _places.TryRemove(key, out _);
        foreach (var (key, place) in places)
        {
            var (_, watch) = _places.AddOrUpdate(key, _ => (place, new Watch()), (_, existing) => (place, existing.Watch));
            var forecast = (watch.Forecast ?? Empty(place)) with { Place = place.Name };
            changed |= Set(watch, await RefreshAsync(watch, place.Location, forecast, place.Name, ct));
        }

        if (changed) await SendAsync();
    }

    // Whether the forecast differs from the one before.
    private static bool Set(Watch watch, Forecast forecast)
    {
        var before = watch.Forecast;
        watch.Forecast = forecast;
        return before is null || JsonSerializer.Serialize(before) != JsonSerializer.Serialize(forecast);
    }

    private async Task<Forecast> UpdateHomeyAsync(Homeys.Entry entry, Watch watch, CancellationToken ct)
    {
        var state = entry.State;
        if (state.Location is not { } location)
        {
            watch.Location = null;
            return Empty(entry, state.LocationRefused ? "noLocation" : "loading");
        }
        var forecast = watch.Location == location && watch.Forecast is { } known ? known : Empty(entry, "loading");
        forecast = forecast with { AccountName = entry.Name, Place = state.Weather?.City ?? forecast.Place };
        return await RefreshAsync(watch, location, forecast, entry.Name, ct);
    }

    // Asks for what is due: the forecast, the rain, or both; a location that moved starts over.
    private async Task<Forecast> RefreshAsync(Watch watch, HomeyLocation location, Forecast forecast, string name, CancellationToken ct)
    {
        if (watch.Location != location)
        {
            watch.Location = location;
            watch.ForecastAt = watch.RainAt = DateTimeOffset.MinValue;
            watch.Failed = false;
        }
        var now = time.GetUtcNow();

        if (now - watch.ForecastAt >= (watch.Failed ? RetryEvery : ForecastEvery))
        {
            watch.ForecastAt = now;
            try
            {
                var fresh = await source.ForecastAsync(location, ct);
                forecast = forecast with { Status = "connected", Error = null, Now = fresh.Now, Hours = fresh.Hours, Days = fresh.Days, UpdatedAt = now };
                watch.Failed = false;
            }
            catch (WeatherException e)
            {
                logger.LogWarning("No forecast for {Name}: {Error}", name, e.Message);
                forecast = forecast with { Status = "disconnected", Error = e.Message };
                watch.Failed = true;
            }
        }

        if (now - watch.RainAt >= RainEvery)
        {
            watch.RainAt = now;
            try
            {
                forecast = forecast with { Rain = await source.RainAsync(location, ct) };
            }
            catch (WeatherException e)
            {
                // Rain only adds to the forecast; the tile leaves it out.
                logger.LogDebug("No rain for {Name}: {Error}", name, e.Message);
                forecast = forecast with { Rain = null };
            }
        }
        return forecast;
    }

    // The places of every weather tile in a dashboard's draft or published version, logic tiles' included, by key.
    private async Task<Dictionary<string, WeatherPlace>> PlacesAsync(CancellationToken ct)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var dashboards = await scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>().Dashboards.AsNoTracking().ToListAsync(ct);
            return dashboards
                .SelectMany(d => d.Published is null ? [d.Draft] : new[] { d.Draft, d.Published })
                .SelectMany(layout => layout.Sections.SelectMany(s => s.Tiles))
                .SelectMany(t => t.Kind == LogicTiles.Kind ? LogicTiles.Held(t.Settings) : [t.Settings])
                .Select(WeatherPlace.Of)
                .OfType<WeatherPlace>()
                .GroupBy(p => p.Key)
                .ToDictionary(g => g.Key, g => g.First());
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Could not read the weather tiles' places");
            return _places.ToDictionary(p => p.Key, p => p.Value.Place);
        }
    }

    private async Task SendAsync()
    {
        try
        {
            await hub.Clients.All.SendAsync("Forecasts", All);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Could not push the weather");
        }
    }
}
