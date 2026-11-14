using System.Text.Json;
using System.Text.Json.Serialization;

namespace HomeyDash.Api.Rules;

// Signals, conditions and rules (ADR-0010). Mirrored in libs/api-client/src/lib/rules.ts.

// There is no enum type: a text signal with AllowedValues is one.
public enum SignalType { Text, YesNo, Number, DateTime }

// One of the values a text signal takes, such as a thermostat mode or a display, with what people call it.
public sealed record AllowedValue(string Value, string Label);

/// <summary>
/// A live value HomeyDash knows, as the signal catalogue lists it. Source is homey, clock, display, plex or timers; Group is
/// what the signal belongs to within it, such as its device. The rest only helps people write conditions.
/// </summary>
public sealed record SignalInfo(string Id, string Source, SignalType Type, string Name, string Group)
{
    // The account of a Homey or Plex signal.
    public int? Account { get; init; }
    public string? AccountName { get; init; }

    // Text: the values it takes, when they are a fixed set.
    public IReadOnlyList<AllowedValue>? AllowedValues { get; init; }

    // Number: its unit and range.
    public string? Unit { get; init; }
    public double? Min { get; init; }
    public double? Max { get; init; }
    public double? Step { get; init; }

    // Yes/no: what true and false mean for it, such as open and closed.
    public string? TrueLabel { get; init; }
    public string? FalseLabel { get; init; }

    // The clock: its value is always now, so time-based conditions on it change as time passes.
    [JsonIgnore]
    public bool MovesWithTime { get; init; }
}

public enum SignalPresence
{
    Known,
    // It exists but has no value yet, such as before Homey's data first arrived.
    NoValue,
    // It no longer exists, such as a removed device or account.
    Missing,
}

/// <summary>
/// What a signal is now. Value is a string, bool, double or DateTimeOffset as its type says. An Unavailable signal is
/// Known with its last known value.
/// </summary>
public readonly record struct SignalReading(SignalPresence Presence, object? Value = null)
{
    public static SignalReading Missing => new(SignalPresence.Missing);
    public static SignalReading NoValue => new(SignalPresence.NoValue);

    public static SignalReading Of(object? value) => value is null ? NoValue : new(SignalPresence.Known, value);
}

/// <summary>
/// Whom a rule is evaluated for: the screen that subscribed (whose display follows it through a takeover), or the
/// display Management chose to see it as; neither when it is seen as on no display.
/// </summary>
public sealed record RuleContext(Guid? ScreenId = null, Guid? DisplayId = null)
{
    public static RuleContext None { get; } = new();
}

public enum RuleMatch { All, Any }

// What a rule combines: a condition, or a group of conditions, which is a rule of its own.
[JsonConverter(typeof(TermConverter))]
public abstract record Term;

/// <summary>
/// One signal compared with a fixed value by an operator that suits the signal's type, optionally negated. Value's
/// shape depends on the operator (see <see cref="Operators"/>); is true, is false and is empty take none.
/// </summary>
public sealed record Condition(string Signal, string Operator, JsonElement Value = default, bool Not = false) : Term;

/// <summary>
/// One or more conditions or groups, of which all, or any, must hold; such as any of (all of A and B) and C.
/// </summary>
public sealed record Rule(RuleMatch Match, IReadOnlyList<Term> Conditions) : Term
{
    // Its conditions, and those of its groups.
    public IEnumerable<Condition> AllConditions() =>
        Conditions.SelectMany(term => term switch
        {
            Rule group => group.AllConditions(),
            Condition condition => [condition],
            _ => [],
        });
}

// A term with "conditions" is a group, any other a condition.
public sealed class TermConverter : JsonConverter<Term>
{
    public override Term? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var json = JsonElement.ParseValue(ref reader);
        if (json.ValueKind == JsonValueKind.Null) return null;
        return json.ValueKind == JsonValueKind.Object && json.TryGetProperty("conditions", out _)
            ? json.Deserialize<Rule>(options)
            : json.Deserialize<Condition>(options);
    }

    public override void Write(Utf8JsonWriter writer, Term value, JsonSerializerOptions options) =>
        JsonSerializer.Serialize(writer, value, value.GetType(), options);
}

// An answer to a subscription. Seq orders every answer HomeyDash sends, so a client keeps the latest.
public sealed record RuleAnswer(bool Holds, long Seq);

// The answers that one change altered, sent together, so a tile never sees an in-between set.
public sealed record RuleAnswers(long Seq, Dictionary<string, bool> Answers);
