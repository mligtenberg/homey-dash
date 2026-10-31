namespace HomeyDash.Api.Rules;

/// <summary>
/// Where signals come from. Each source owns ids with its own prefix (<c>homey:</c>, <c>clock:</c>, …); a module adds
/// signals by registering another source with <see cref="RuleSetup.AddSignalSource{T}"/>.
/// </summary>
public interface ISignalSource
{
    // Whether the id is one of this source's, whether or not that signal exists now.
    bool Owns(string signalId);

    // The signals there are now, for the catalogue.
    IEnumerable<SignalInfo> Signals();

    // The signal as it is now; null when it doesn't exist, or can't be told yet.
    SignalInfo? Find(string signalId);

    // Whether the signal exists; null while that can't be told, such as before Homey's data first arrived.
    bool? Knows(string signalId);

    SignalReading Read(string signalId, RuleContext context);

    // Raised whenever a signal's value may have changed, or signals came or went.
    event Action? Changed;
}
