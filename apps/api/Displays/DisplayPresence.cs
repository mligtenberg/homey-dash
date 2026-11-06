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

    // What each screen last reported about itself, for Management.
    private readonly ConcurrentDictionary<Guid, bool> _kiosks = new();
    private readonly ConcurrentDictionary<Guid, double> _lux = new();

    private readonly ConcurrentDictionary<Guid, ScreenDetails> _details = new();

    public void ReportDetails(Guid screenId, ScreenDetails details) => _details[screenId] = details.Cleaned();

    /// <summary>What the screen last said about itself, or null before it has.</summary>
    public ScreenDetails? Details(Guid? screenId) => screenId is { } id && _details.TryGetValue(id, out var d) ? d : null;

    public void ReportKiosk(Guid screenId) => _kiosks[screenId] = true;

    public void ReportLux(Guid screenId, double lux) => _lux[screenId] = lux;

    /// <summary>Whether the screen runs in Fully Kiosk Browser, as it last said.</summary>
    public bool IsKiosk(Guid? screenId) => screenId is { } id && _kiosks.ContainsKey(id);

    /// <summary>How much light falls on the screen in lux, as it last measured.</summary>
    public double? Lux(Guid? screenId) => screenId is { } id && _lux.TryGetValue(id, out var lux) ? lux : null;

    public bool IsConnected(Guid? screenId) => screenId is { } id && _connections.GetValueOrDefault(id) > 0;
}
