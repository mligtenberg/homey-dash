using System.Collections.Concurrent;
using HomeyDash.Api.Data;
using HomeyDash.Api.Homey;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.Realtime;

/// <summary>Passes every change in Homey on to every realtime connection.</summary>
public sealed class HomeyBroadcaster(HomeyState state, IHubContext<RealtimeHub> hub,
    IServiceScopeFactory scopes, ILogger<HomeyBroadcaster> logger)
    : IHostedService
{
    private readonly ConcurrentDictionary<string, byte> _devices = new();
    private int _dashboardsPending;

    public Task StartAsync(CancellationToken ct)
    {
        state.Changed += OnChanged;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken ct)
    {
        state.Changed -= OnChanged;
        return Task.CompletedTask;
    }

    private void OnChanged(HomeyChange change)
    {
        Push(change);
        // Only changes that can alter a missing-tile count: devices coming or going, the catalog, (re)connecting.
        var newDevice = change is DeviceChanged c && _devices.TryAdd(c.Device.Id, 0);
        if (change is DeviceRemoved r) _devices.TryRemove(r.DeviceId, out _);
        if (newDevice || change is DeviceRemoved or CatalogChanged or ConnectionChanged { Status.Connection: HomeyConnection.Connected })
            _ = PushDashboardsAsync();
    }

    private void Push(HomeyChange change) => _ = SendAsync(change switch
    {
        DeviceChanged c => ("DeviceChanged", c.Device),
        DeviceRemoved c => ("DeviceRemoved", c.DeviceId),
        CatalogChanged => ("Catalog", new HomeyCatalog(state.Flows.OrderBy(f => f.Name), state.Moods.OrderBy(m => m.Name),
            state.Zones.OrderBy(z => z.Name), state.FlowFolders.OrderBy(f => f.Name))),
        ConnectionChanged c => ("HomeyStatus", c.Status),
        _ => throw new ArgumentOutOfRangeException(nameof(change), change, null),
    });

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
