using HomeyDash.Api.Timers;

namespace HomeyDash.Api.Rules;

/// <summary>
/// The shared timers, <c>timers:running</c>: whether there are any. A timer counts until it is removed, so one that is
/// paused or has run out and rings still counts. It has no value until the timers are known (<see cref="Set"/>).
/// </summary>
public sealed class TimerSignals : ISignalSource
{
    public const string Running = "timers:running";

    private static readonly SignalInfo Info = new(Running, "timers", SignalType.YesNo, "Are there running timers?", "Timers");

    private bool? _any;

    public event Action? Changed;

    // Told whenever the timers change, and once at startup.
    public void Set(IReadOnlyCollection<TimerView> timers)
    {
        var any = timers.Count > 0;
        if (_any == any) return;
        _any = any;
        Changed?.Invoke();
    }

    public bool Owns(string signalId) => signalId.StartsWith("timers:", StringComparison.Ordinal);

    public IEnumerable<SignalInfo> Signals() => [Info];

    public SignalInfo? Find(string signalId) => signalId == Running ? Info : null;

    public bool? Knows(string signalId) => signalId == Running;

    public SignalReading Read(string signalId, RuleContext context) =>
        signalId == Running && _any is { } any ? SignalReading.Of(any) : SignalReading.NoValue;
}
