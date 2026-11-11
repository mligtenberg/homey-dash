namespace HomeyDash.Api.Timers;

/// <summary>
/// A kitchen timer shared by every screen. Running, it ends at <see cref="End"/> (ms since the epoch); paused,
/// <see cref="Paused"/> is what is left (ms). Screens work out the rest, so a timer needs no ticking here.
/// </summary>
public sealed class SharedTimer
{
    public const int MaxNameLength = 100;
    public const int MaxTimers = 50;

    public required Guid Id { get; init; }
    public int Seconds { get; set; }
    public long End { get; set; }
    public long? Paused { get; set; }
    public string? Name { get; set; }
    public string Sound { get; set; } = "beep";
}

/// <summary>A timer as screens send and receive it. Mirrored in libs/api-client/src/lib/timers.ts.</summary>
public sealed record TimerView(Guid Id, int Seconds, long End, long? Paused, string? Name, string Sound)
{
    private static readonly string[] Sounds = ["beep", "bell", "chime", "none"];

    public static TimerView Of(SharedTimer t) => new(t.Id, t.Seconds, t.End, t.Paused, t.Name, t.Sound);

    public void CopyTo(SharedTimer t)
    {
        t.Seconds = Math.Clamp(Seconds, 1, 24 * 3600 * 7);
        t.End = End;
        t.Paused = Paused;
        var name = Name?.Trim();
        t.Name = string.IsNullOrEmpty(name) ? null : name[..Math.Min(name.Length, SharedTimer.MaxNameLength)];
        t.Sound = Sounds.Contains(Sound) ? Sound : "beep";
    }
}
