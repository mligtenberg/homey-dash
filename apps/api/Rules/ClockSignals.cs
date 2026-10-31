namespace HomeyDash.Api.Rules;

/// <summary>
/// The clock, <c>clock:now</c>. It never raises Changed: conditions on it are checked again at the moment their answer
/// would change.
/// </summary>
public sealed class ClockSignals(TimeProvider time) : ISignalSource
{
    public const string Now = "clock:now";

    private static readonly SignalInfo Info = new(Now, "clock", SignalType.DateTime, "Now", "Clock") { MovesWithTime = true };

    public event Action? Changed { add { } remove { } }

    public bool Owns(string signalId) => signalId.StartsWith("clock:", StringComparison.Ordinal);

    public IEnumerable<SignalInfo> Signals() => [Info];

    public SignalInfo? Find(string signalId) => signalId == Now ? Info : null;

    public bool? Knows(string signalId) => signalId == Now;

    public SignalReading Read(string signalId, RuleContext context) =>
        signalId == Now ? SignalReading.Of(time.GetUtcNow()) : SignalReading.Missing;
}
