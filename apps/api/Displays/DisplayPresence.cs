using System.Collections.Concurrent;

namespace HomeyDash.Api.Displays;

/// <summary>
/// Which screens have a realtime connection open right now. Kept by screen rather than display, so a takeover
/// carries the connected state to the new screen without any bookkeeping.
/// </summary>
public sealed class DisplayPresence
{
    // A screen may have more than one connection, for example two browser tabs.
    private readonly ConcurrentDictionary<Guid, int> _connections = new();

    public void Connect(Guid screenId) => _connections.AddOrUpdate(screenId, 1, (_, n) => n + 1);

    public void Disconnect(Guid screenId) => _connections.AddOrUpdate(screenId, 0, (_, n) => Math.Max(0, n - 1));

    public bool IsConnected(Guid? screenId) => screenId is { } id && _connections.GetValueOrDefault(id) > 0;
}
