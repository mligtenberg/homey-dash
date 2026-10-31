using HomeyDash.Api.Plex;

namespace HomeyDash.Api.Rules;

/// <summary>
/// What plays on Plex (ADR-0009), as text that is playing, paused or stopped: <c>plex:{account}:any</c> for whatever
/// plays on any player (playing wins over paused), and <c>plex:{account}:player:{player}</c> for one player. A removed
/// account is missing; players come and go as they play, so one is never missing, and stopped while it plays nothing.
/// </summary>
public sealed class PlexSignals : ISignalSource, IDisposable
{
    private const string Prefix = "plex:";

    private static readonly IReadOnlyList<AllowedValue> States =
        [new("playing", "Playing"), new("paused", "Paused"), new("stopped", "Stopped")];

    private readonly PlexWatcher _watcher;

    public PlexSignals(PlexWatcher watcher)
    {
        _watcher = watcher;
        _watcher.Changed += OnChanged;
    }

    public event Action? Changed;

    public bool Owns(string signalId) => signalId.StartsWith(Prefix, StringComparison.Ordinal);

    public IEnumerable<SignalInfo> Signals() => _watcher.Overviews.SelectMany(o => (IEnumerable<SignalInfo>)
    [
        Info($"{Prefix}{o.AccountId}:any", "Any player", o),
        .. o.Players.Select(p => Info($"{Prefix}{o.AccountId}:player:{p.Id}", p.Name, o)),
    ]);

    public SignalInfo? Find(string signalId) =>
        Parse(signalId) is ({ } overview, var playerId)
            ? Info(signalId, playerId is null ? "Any player" : overview.Players.FirstOrDefault(p => p.Id == playerId)?.Name ?? playerId, overview)
            : null;

    public bool? Knows(string signalId) => Parse(signalId) is ({ }, _);

    public SignalReading Read(string signalId, RuleContext context)
    {
        if (Parse(signalId) is not ({ } overview, var playerId)) return SignalReading.Missing;
        if (!overview.Loaded) return SignalReading.NoValue;
        var states = _watcher.Sessions
            .Where(s => s.AccountId == overview.AccountId && (playerId is null || s.PlayerId == playerId))
            .Select(s => s.State)
            .ToList();
        // Plex says buffering while it loads what plays.
        return SignalReading.Of(states.Any(s => s is "playing" or "buffering") ? "playing" : states.Count > 0 ? "paused" : "stopped");
    }

    // The account's overview (null once the account is removed), and the player, or null for any.
    private (PlexOverview? Overview, string? PlayerId)? Parse(string signalId)
    {
        if (!Owns(signalId)) return null;
        var parts = signalId.Split(':', 4);
        if (parts.Length < 3 || !int.TryParse(parts[1], out var account)) return null;
        var overview = _watcher.Overviews.FirstOrDefault(o => o.AccountId == account);
        return parts switch
        {
            [_, _, "any"] => (overview, null),
            [_, _, "player", var player] => (overview, player),
            _ => null,
        };
    }

    private static SignalInfo Info(string id, string name, PlexOverview overview) =>
        new(id, "plex", SignalType.Text, name, "Players")
        {
            Account = overview.AccountId,
            AccountName = overview.AccountName,
            AllowedValues = States,
        };

    private void OnChanged() => Changed?.Invoke();

    public void Dispose() => _watcher.Changed -= OnChanged;
}
