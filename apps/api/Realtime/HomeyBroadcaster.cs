using System.Collections.Concurrent;
using HomeyDash.Api.Data;
using HomeyDash.Api.Homey;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.Realtime;

/// <summary>Passes every change in every Homey on to every realtime connection, naming the Homey's account.</summary>
public sealed class HomeyBroadcaster(Homeys homeys, IHubContext<RealtimeHub> hub,
    IServiceScopeFactory scopes, ILogger<HomeyBroadcaster> logger)
    : IHostedService
{
    private readonly Lock _lock = new();
    // The Homeys listened to, by account, with the handler listening.
    private readonly Dictionary<int, (HomeyState State, Action<HomeyChange> Handler)> _listening = [];
    private readonly ConcurrentDictionary<(int, string), byte> _devices = new();
    private readonly ConcurrentDictionary<(int, string), byte> _variables = new();
    private int _dashboardsPending;

    public Task StartAsync(CancellationToken ct)
    {
        homeys.Changed += OnHomeysChanged;
        Listen();
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken ct)
    {
        homeys.Changed -= OnHomeysChanged;
        lock (_lock)
        {
            foreach (var (state, handler) in _listening.Values) state.Changed -= handler;
            _listening.Clear();
        }
        return Task.CompletedTask;
    }

    // An account added, removed or renamed: every Homey again, and missing-tile counts may differ.
    private void OnHomeysChanged()
    {
        Listen();
        _ = SendAsync(("Homeys", HomeySnapshot.All(homeys)));
        _ = PushDashboardsAsync();
    }

    private void Listen()
    {
        lock (_lock)
        {
            var current = homeys.All.ToDictionary(e => e.AccountId, e => e.State);
            foreach (var (id, (state, handler)) in _listening.ToList())
            {
                if (current.GetValueOrDefault(id) == state) continue;
                state.Changed -= handler;
                _listening.Remove(id);
            }
            foreach (var (id, state) in current)
            {
                if (_listening.ContainsKey(id)) continue;
                Action<HomeyChange> handler = change => OnChanged(id, state, change);
                state.Changed += handler;
                _listening[id] = (state, handler);
            }
        }
    }

    private void OnChanged(int accountId, HomeyState state, HomeyChange change)
    {
        Push(accountId, state, change);
        // Only changes that can alter a missing-tile count: devices or variables (which rules use) coming or going, the
        // catalog, (re)connecting.
        var newDevice = change is DeviceChanged c && _devices.TryAdd((accountId, c.Device.Id), 0);
        if (change is DeviceRemoved r) _devices.TryRemove((accountId, r.DeviceId), out _);
        var newVariable = change is VariableChanged v && _variables.TryAdd((accountId, v.Variable.Id), 0);
        if (change is VariableRemoved vr) _variables.TryRemove((accountId, vr.VariableId), out _);
        if (newDevice || newVariable || change is DeviceRemoved or VariableRemoved or CatalogChanged
                or ConnectionChanged { Status.Connection: HomeyConnection.Connected })
            _ = PushDashboardsAsync();
    }

    // Variables only feed rules, which HomeyDash evaluates itself (ADR-0010), so they are not passed on.
    private void Push(int accountId, HomeyState state, HomeyChange change)
    {
        if (change is VariableChanged or VariableRemoved) return;
        _ = SendAsync(change switch
        {
            DeviceChanged c => ("DeviceChanged", new HomeyDeviceChange(accountId, c.Device)),
            DeviceRemoved c => ("DeviceRemoved", new HomeyDeviceRemoval(accountId, c.DeviceId)),
            CatalogChanged => ("Catalog", new HomeyCatalog(accountId, state.Flows.OrderBy(f => f.Name), state.Moods.OrderBy(m => m.Name),
                state.Zones.OrderBy(z => z.Name), state.FlowFolders.OrderBy(f => f.Name))),
            WeatherChanged c => ("Weather", new HomeyWeatherChange(accountId, c.Weather)),
            EnergyChanged c => ("Energy", new HomeyEnergyChange(accountId, c.Energy)),
            ConnectionChanged c => ("HomeyStatus", c.Status),
            _ => throw new ArgumentOutOfRangeException(nameof(change), change, null),
        });
    }

    // Coalesces a burst, such as the first load that adds every device, into one push.
    private async Task PushDashboardsAsync()
    {
        if (Interlocked.Exchange(ref _dashboardsPending, 1) == 1) return;
        try
        {
            await Task.Delay(TimeSpan.FromMilliseconds(250));
            Volatile.Write(ref _dashboardsPending, 0);
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<RealtimeNotifier>()
                .DashboardsChangedAsync(scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>(), CancellationToken.None);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Could not push the dashboard list to Management");
        }
    }

    private async Task SendAsync((string Method, object Arg) message)
    {
        try
        {
            await hub.Clients.All.SendAsync(message.Method, message.Arg);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Could not send {Method} to realtime connections", message.Method);
        }
    }
}
