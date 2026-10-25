using HomeyDash.Api.Homey;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.Realtime;

/// <summary>Passes every change in Homey on to every realtime connection.</summary>
public sealed class HomeyBroadcaster(HomeyState state, IHubContext<RealtimeHub> hub, ILogger<HomeyBroadcaster> logger)
    : IHostedService
{
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

    private void OnChanged(HomeyChange change) => _ = SendAsync(change switch
    {
        DeviceChanged c => ("DeviceChanged", c.Device),
        DeviceRemoved c => ("DeviceRemoved", c.DeviceId),
        CatalogChanged => ("Catalog", new HomeyCatalog(state.Flows.OrderBy(f => f.Name), state.Moods.OrderBy(m => m.Name))),
        ConnectionChanged c => ("HomeyStatus", c.Status),
        _ => throw new ArgumentOutOfRangeException(nameof(change), change, null),
    });

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
