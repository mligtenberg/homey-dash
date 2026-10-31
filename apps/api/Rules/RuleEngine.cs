using System.Text.Json;
using HomeyDash.Api.Dashboards;

namespace HomeyDash.Api.Rules;

/// <summary>
/// Knows signals, conditions and rules, and nothing about tile kinds (ADR-0010). Evaluates a rule against live signals
/// from every <see cref="ISignalSource"/>, for a display or none. <c>Changed</c> is raised whenever any signal may have
/// changed; time-based conditions say instead when their answer could next change.
/// </summary>
public sealed class RuleEngine
{
    private readonly IReadOnlyList<ISignalSource> _sources;
    private readonly TimeProvider _time;

    public RuleEngine(IEnumerable<ISignalSource> sources, TimeProvider time)
    {
        _sources = sources.ToList();
        _time = time;
        foreach (var source in _sources) source.Changed += () => Changed?.Invoke();
    }

    public event Action? Changed;

    public IEnumerable<SignalInfo> Signals() => _sources.SelectMany(s => s.Signals());

    public SignalInfo? Find(string signalId) => Owner(signalId)?.Find(signalId);

    // Whether a signal exists; false for one no source knows, null while that can't be told yet.
    public bool? Knows(string signalId) => Owner(signalId) is { } source ? source.Knows(signalId) : false;

    private ISignalSource? Owner(string signalId) => _sources.FirstOrDefault(s => s.Owns(signalId));

    /// <summary>Reads a rule as JSON, or says why it isn't one.</summary>
    public static (Rule? Rule, string? Error) Parse(JsonElement json)
    {
        try
        {
            var rule = json.ValueKind == JsonValueKind.Object ? json.Deserialize<Rule>(Dashboard.Json) : null;
            return rule?.Conditions is null
                ? (null, "A rule is { \"match\": \"all\" or \"any\", \"conditions\": [...] }.")
                : (rule, null);
        }
        catch (JsonException e)
        {
            return (null, $"This is not a rule: {e.Message}");
        }
    }

    /// <summary>
    /// What is wrong with a rule, keyed by where (such as <c>conditions[1]</c>): no conditions, an unknown signal, an
    /// operator that doesn't suit the signal's type, or a value that doesn't suit the operator. A signal that is missing
    /// now is checked against every type the operator suits, so a rule on it can still be saved.
    /// </summary>
    public List<(string Key, string Message)> Validate(Rule rule)
    {
        List<(string, string)> problems = [];
        if (rule.Conditions.Count == 0) problems.Add(("conditions", "A rule needs at least one condition."));
        for (var i = 0; i < rule.Conditions.Count; i++)
        {
            var key = $"conditions[{i}]";
            var condition = rule.Conditions[i];
            if (condition is null || string.IsNullOrWhiteSpace(condition.Signal) || string.IsNullOrWhiteSpace(condition.Operator))
            {
                problems.Add((key, "A condition needs a signal and an operator."));
                continue;
            }
            if (Owner(condition.Signal) is not { } source)
            {
                problems.Add((key, $"There is no signal \"{condition.Signal}\"; list_signals and the signal catalogue name them."));
                continue;
            }
            if (source.Find(condition.Signal) is { } signal)
            {
                if (Operators.Compile(signal.Type, condition.Operator, condition.Value) is (null, var error)) problems.Add((key, error!));
                continue;
            }
            var types = Operators.ByType.Where(t => t.Value.Contains(condition.Operator)).Select(t => t.Key).ToList();
            if (types.Count == 0)
                problems.Add((key, $"There is no operator \"{condition.Operator}\"."));
            else if (types.All(t => Operators.Compile(t, condition.Operator, condition.Value).Test is null))
                problems.Add((key, Operators.Compile(types[0], condition.Operator, condition.Value).Error!));
        }
        return problems;
    }

    /// <summary>
    /// Whether a rule holds now for a display, and when its answer could next change as time passes (null when only a
    /// signal changing can change it). A condition on a missing signal, one without a value yet, or one comparing with a
    /// value no longer among its signal's allowed values never holds, negated or not. One on an unavailable signal
    /// uses its last known value.
    /// </summary>
    public (bool Holds, DateTimeOffset? Next) Evaluate(Rule rule, RuleContext context)
    {
        var now = _time.GetUtcNow();
        var zone = _time.LocalTimeZone;
        var answers = new List<bool>();
        DateTimeOffset? next = null;
        foreach (var condition in rule.Conditions)
        {
            var (holds, at) = Evaluate(condition, context, now, zone);
            answers.Add(holds);
            if (at is { } a && (next is null || a < next)) next = a;
        }
        var result = rule.Match == RuleMatch.All ? answers.Count > 0 && answers.All(a => a) : answers.Any(a => a);
        return (result, next);
    }

    private (bool Holds, DateTimeOffset? Next) Evaluate(Condition condition, RuleContext context, DateTimeOffset now, TimeZoneInfo zone)
    {
        if (Owner(condition.Signal) is not { } source) return (false, null);
        var reading = source.Read(condition.Signal, context);
        if (reading.Presence != SignalPresence.Known || source.Find(condition.Signal) is not { } signal) return (false, null);
        if (signal.AllowedValues is { } allowed && condition.Operator == "equals" && condition.Value.ValueKind == JsonValueKind.String
            && allowed.All(v => v.Value != condition.Value.GetString()))
            return (false, null);
        if (Operators.Compile(signal.Type, condition.Operator, condition.Value).Test is not { } test) return (false, null);
        try
        {
            var holds = test.Holds(reading.Value!, now, zone);
            var next = test.Next is { } n && reading.Value is DateTimeOffset value ? n(value, signal.MovesWithTime, now, zone) : null;
            return (condition.Not ? !holds : holds, next);
        }
        catch (InvalidCastException)
        {
            // The signal's value is of another type than it says.
            return (false, null);
        }
    }
}
