using System.Globalization;
using System.Text.Json;

namespace HomeyDash.Api.Rules;

/// <summary>
/// The operators each signal type offers, and how a condition's value reads for each:
/// <list type="bullet">
/// <item>number: equals, greaterThan, lessThan (a number); between (<c>{ "min": 18, "max": 21 }</c>, both included)</item>
/// <item>yesNo: isTrue, isFalse (no value)</item>
/// <item>text: equals, contains, startsWith (a string); isEmpty (no value)</item>
/// <item>dateTime: timeOfDayBetween (<c>{ "from": "22:00", "to": "06:30" }</c>, may wrap midnight, seconds optional);
/// onWeekdays (<c>["saturday", "sunday"]</c>); withinLast, longerAgoThan (<c>{ "amount": 30, "unit": "seconds" }</c>,
/// unit seconds, minutes, hours or days); dateBetween (<c>{ "from": "12-01", "to": "01-06" }</c>, month-day, both
/// included, every year); before, after (a moment, such as <c>"2026-12-24T18:00:00+01:00"</c>)</item>
/// </list>
/// Times of day, weekdays and dates are in HomeyDash's local time zone.
/// </summary>
public static class Operators
{
    public static readonly IReadOnlyDictionary<SignalType, IReadOnlyList<string>> ByType = new Dictionary<SignalType, IReadOnlyList<string>>
    {
        [SignalType.Number] = ["equals", "greaterThan", "lessThan", "between"],
        [SignalType.YesNo] = ["isTrue", "isFalse"],
        [SignalType.Text] = ["equals", "contains", "startsWith", "isEmpty"],
        [SignalType.DateTime] = ["timeOfDayBetween", "onWeekdays", "withinLast", "longerAgoThan", "dateBetween", "before", "after"],
    };

    /// <summary>
    /// A compiled comparison. Holds tells whether a value passes at a moment; Next, when the answer could next change
    /// as time passes, for a date and time (null when only a new value can change it).
    /// </summary>
    public sealed record Test(
        Func<object, DateTimeOffset, TimeZoneInfo, bool> Holds,
        Func<DateTimeOffset, bool, DateTimeOffset, TimeZoneInfo, DateTimeOffset?>? Next = null);

    private static readonly string[] Units = ["seconds", "minutes", "hours", "days"];

    /// <summary>The test an operator makes for a signal type, or why its value doesn't suit it.</summary>
    public static (Test? Test, string? Error) Compile(SignalType type, string op, JsonElement value)
    {
        if (!ByType[type].Contains(op))
            return (null, $"The operator \"{op}\" doesn't suit a {Name(type)} signal; use {string.Join(", ", ByType[type])}.");
        try
        {
            return (CompileValue(type, op, value), null);
        }
        catch (Exception e) when (e is FormatException or InvalidOperationException or KeyNotFoundException or ArgumentException or OverflowException)
        {
            return (null, $"The value doesn't suit \"{op}\": {e.Message}");
        }
    }

    public static string Name(SignalType type) => type switch
    {
        SignalType.YesNo => "yes/no",
        SignalType.DateTime => "date and time",
        _ => type.ToString().ToLowerInvariant(),
    };

    private static Test CompileValue(SignalType type, string op, JsonElement value)
    {
        switch (type, op)
        {
            case (SignalType.Number, "equals"):
            {
                var n = Number(value);
                return new((v, _, _) => (double)v == n);
            }
            case (SignalType.Number, "greaterThan"):
            {
                var n = Number(value);
                return new((v, _, _) => (double)v > n);
            }
            case (SignalType.Number, "lessThan"):
            {
                var n = Number(value);
                return new((v, _, _) => (double)v < n);
            }
            case (SignalType.Number, "between"):
            {
                var (min, max) = (Number(Property(value, "min")), Number(Property(value, "max")));
                if (min > max) throw new ArgumentException("min is above max.");
                return new((v, _, _) => (double)v >= min && (double)v <= max);
            }
            case (SignalType.YesNo, "isTrue"):
                return new((v, _, _) => (bool)v);
            case (SignalType.YesNo, "isFalse"):
                return new((v, _, _) => !(bool)v);
            case (SignalType.Text, "equals"):
            {
                var s = Text(value);
                return new((v, _, _) => (string)v == s);
            }
            case (SignalType.Text, "contains"):
            {
                var s = Text(value);
                return new((v, _, _) => ((string)v).Contains(s, StringComparison.CurrentCultureIgnoreCase));
            }
            case (SignalType.Text, "startsWith"):
            {
                var s = Text(value);
                return new((v, _, _) => ((string)v).StartsWith(s, StringComparison.CurrentCultureIgnoreCase));
            }
            case (SignalType.Text, "isEmpty"):
                return new((v, _, _) => ((string)v).Length == 0);
            case (SignalType.DateTime, "timeOfDayBetween"):
            {
                var (from, to) = (TimeOfDay(Property(value, "from")), TimeOfDay(Property(value, "to")));
                if (from == to) throw new ArgumentException("from and to are the same time.");
                return new(
                    (v, _, zone) =>
                    {
                        var at = TimeOnly.FromTimeSpan(Local((DateTimeOffset)v, zone).TimeOfDay);
                        return from < to ? at >= from && at < to : at >= from || at < to;
                    },
                    (_, moves, now, zone) => moves ? Earliest(NextLocal(now, from, zone), NextLocal(now, to, zone)) : null);
            }
            case (SignalType.DateTime, "onWeekdays"):
            {
                var days = value.EnumerateArray().Select(d => Enum.Parse<DayOfWeek>(d.GetString()!, ignoreCase: true)).ToHashSet();
                return new((v, _, zone) => days.Contains(Local((DateTimeOffset)v, zone).DayOfWeek), NextMidnight);
            }
            case (SignalType.DateTime, "withinLast"):
            {
                var span = Span(value);
                return new((v, now, _) => now - (DateTimeOffset)v < span, (v, moves, now, _) => moves ? null : Later(v + span, now));
            }
            case (SignalType.DateTime, "longerAgoThan"):
            {
                var span = Span(value);
                return new((v, now, _) => now - (DateTimeOffset)v >= span, (v, moves, now, _) => moves ? null : Later(v + span, now));
            }
            case (SignalType.DateTime, "dateBetween"):
            {
                var (from, to) = (MonthDay(Property(value, "from")), MonthDay(Property(value, "to")));
                return new(
                    (v, _, zone) =>
                    {
                        var date = Local((DateTimeOffset)v, zone);
                        var day = (date.Month, date.Day);
                        return from.CompareTo(to) <= 0
                            ? day.CompareTo(from) >= 0 && day.CompareTo(to) <= 0
                            : day.CompareTo(from) >= 0 || day.CompareTo(to) <= 0;
                    },
                    NextMidnight);
            }
            case (SignalType.DateTime, "before"):
            {
                var moment = Moment(value);
                return new((v, _, _) => (DateTimeOffset)v < moment, (_, moves, now, _) => moves ? Later(moment, now) : null);
            }
            case (SignalType.DateTime, "after"):
            {
                var moment = Moment(value);
                return new((v, _, _) => (DateTimeOffset)v >= moment, (_, moves, now, _) => moves ? Later(moment, now) : null);
            }
            default:
                throw new ArgumentException($"Unknown operator {op}.");
        }
    }

    private static DateTimeOffset? NextMidnight(DateTimeOffset value, bool moves, DateTimeOffset now, TimeZoneInfo zone) =>
        moves ? NextLocal(now, TimeOnly.MinValue, zone) : null;

    private static DateTimeOffset? Later(DateTimeOffset at, DateTimeOffset now) => at > now ? at : null;

    private static DateTimeOffset? Earliest(DateTimeOffset a, DateTimeOffset b) => a < b ? a : b;

    private static DateTime Local(DateTimeOffset at, TimeZoneInfo zone) => TimeZoneInfo.ConvertTime(at, zone).DateTime;

    // The first moment after now that the local clock shows this time of day.
    private static DateTimeOffset NextLocal(DateTimeOffset now, TimeOnly time, TimeZoneInfo zone)
    {
        var day = Local(now, zone).Date;
        for (var i = 0; ; i++)
        {
            var local = day.AddDays(i) + time.ToTimeSpan();
            // A time the clocks skip, when summer time starts, comes an hour later.
            if (zone.IsInvalidTime(local)) local = local.AddHours(1);
            var at = new DateTimeOffset(local, zone.GetUtcOffset(local));
            if (at > now) return at;
        }
    }

    private static JsonElement Property(JsonElement value, string name) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property)
            ? property
            : throw new ArgumentException($"It needs \"{name}\".");

    private static double Number(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number ? value.GetDouble() : throw new ArgumentException("It needs a number.");

    private static string Text(JsonElement value) =>
        value.ValueKind == JsonValueKind.String ? value.GetString()! : throw new ArgumentException("It needs a text.");

    private static TimeOnly TimeOfDay(JsonElement value) =>
        TimeOnly.ParseExact(Text(value), ["HH:mm", "HH:mm:ss"], CultureInfo.InvariantCulture);

    private static (int Month, int Day) MonthDay(JsonElement value)
    {
        // A leap year, so 02-29 is a day.
        var date = DateOnly.ParseExact($"2024-{Text(value)}", "yyyy-MM-dd", CultureInfo.InvariantCulture);
        return (date.Month, date.Day);
    }

    private static DateTimeOffset Moment(JsonElement value) =>
        DateTimeOffset.Parse(Text(value), CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal);

    private static TimeSpan Span(JsonElement value)
    {
        var amount = Number(Property(value, "amount"));
        if (amount <= 0) throw new ArgumentException("amount is not above 0.");
        return Text(Property(value, "unit")) switch
        {
            "seconds" => TimeSpan.FromSeconds(amount),
            "minutes" => TimeSpan.FromMinutes(amount),
            "hours" => TimeSpan.FromHours(amount),
            "days" => TimeSpan.FromDays(amount),
            var unit => throw new ArgumentException($"unit is {unit}, not one of {string.Join(", ", Units)}."),
        };
    }
}
