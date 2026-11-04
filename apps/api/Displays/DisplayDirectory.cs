using System.Collections.Concurrent;
using HomeyDash.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Displays;

/// <summary>
/// Every display with its name and the screen holding it, kept in memory for evaluating rules on display signals.
/// Refreshed whenever displays change (see <c>RealtimeNotifier.DisplaysChangedAsync</c>).
/// </summary>
public sealed class DisplayDirectory
{
    public sealed record Entry(Guid Id, string Name, Guid? ScreenId);

    private volatile IReadOnlyList<Entry> _all = [];

    public event Action? Changed;

    public IReadOnlyList<Entry> All => _all;

    public Entry? Find(Guid? id) => id is null ? null : _all.FirstOrDefault(d => d.Id == id);

    public Entry? ByScreen(Guid? screenId) => screenId is null ? null : _all.FirstOrDefault(d => d.ScreenId == screenId);

    public async Task RefreshAsync(HomeyDashDbContext db, CancellationToken ct)
    {
        var entries = (await db.Displays.AsNoTracking().Select(d => new Entry(d.Id, d.Name, d.ScreenId)).ToListAsync(ct))
            .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        if (entries.SequenceEqual(_all)) return;
        _all = entries;
        Changed?.Invoke();
    }
}

/// <summary>When each display was last touched, as its screen reports; a display not touched since HomeyDash started has no entry.</summary>
public sealed class DisplayTouches
{
    private readonly ConcurrentDictionary<Guid, DateTimeOffset> _touched = new();

    public event Action? Changed;

    public DateTimeOffset? LastTouched(Guid displayId) => _touched.TryGetValue(displayId, out var at) ? at : null;

    public void Touch(Guid displayId, DateTimeOffset at)
    {
        _touched[displayId] = at;
        Changed?.Invoke();
    }
}

/// <summary>
/// How much light falls on each display, in lux, as its screen last measured with its light sensor or estimated with its
/// camera; a display whose screen has not measured since HomeyDash started has no entry.
/// </summary>
public sealed class DisplayBrightness
{
    private readonly ConcurrentDictionary<Guid, double> _levels = new();

    public event Action? Changed;

    // Beyond direct sunlight, so a wrong reading can't grow without bound.
    public const double MaxLux = 200_000;

    public double? Lux(Guid displayId) => _levels.TryGetValue(displayId, out var lux) ? lux : null;

    public void Measure(Guid displayId, double lux)
    {
        var level = Math.Round(Math.Clamp(lux, 0, MaxLux));
        if (_levels.TryGetValue(displayId, out var was) && was == level) return;
        _levels[displayId] = level;
        Changed?.Invoke();
    }
}
