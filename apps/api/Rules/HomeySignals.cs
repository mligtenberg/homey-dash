using System.Text.Json;
using HomeyDash.Api.Homey;

namespace HomeyDash.Api.Rules;

/// <summary>
/// The capabilities of every device and the Logic variables of every Homey account. Ids name the account:
/// <c>homey:{account}:capability:{device}:{capability}</c>, <c>homey:{account}:changed:{device}:{capability}</c> (when
/// the capability last changed, as a date and time) and <c>homey:{account}:variable:{variable}</c>. A removed account,
/// device, capability or variable is missing; an unreachable Homey or device keeps its last known values.
/// </summary>
public sealed class HomeySignals : ISignalSource, IDisposable
{
    private const string Prefix = "homey:";

    // What true and false mean for the yes/no capabilities Homey has most.
    private static readonly Dictionary<string, (string True, string False)> Labels = new()
    {
        ["onoff"] = ("on", "off"),
        ["alarm_contact"] = ("open", "closed"),
        ["alarm_motion"] = ("motion", "no motion"),
        ["alarm_smoke"] = ("smoke", "no smoke"),
        ["alarm_water"] = ("water", "dry"),
        ["alarm_generic"] = ("alarm", "no alarm"),
        ["locked"] = ("locked", "unlocked"),
        ["garagedoor_closed"] = ("closed", "open"),
    };

    private readonly Homeys _homeys;
    private readonly Lock _lock = new();
    private readonly Dictionary<int, (HomeyState State, Action<HomeyChange> Handler)> _listening = [];

    public HomeySignals(Homeys homeys)
    {
        _homeys = homeys;
        _homeys.Changed += OnHomeysChanged;
        Listen();
    }

    public event Action? Changed;

    public bool Owns(string signalId) => signalId.StartsWith(Prefix, StringComparison.Ordinal);

    public IEnumerable<SignalInfo> Signals() => _homeys.All.SelectMany(entry =>
        entry.State.Devices.OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
            .SelectMany(d => d.Capabilities.Values.SelectMany(c => (IEnumerable<SignalInfo?>)
                [Capability(entry, d, c), LastChanged(entry, d, c)]))
            .Concat(entry.State.Variables.OrderBy(v => v.Name, StringComparer.CurrentCultureIgnoreCase).Select(v => Variable(entry, v)))
            .OfType<SignalInfo>());

    public SignalInfo? Find(string signalId) => Parse(signalId) switch
    {
        ({ } entry, "capability", var deviceId, var capabilityId) when Lookup(entry, deviceId, capabilityId) is (var d, var c) =>
            Capability(entry, d, c),
        ({ } entry, "changed", var deviceId, var capabilityId) when Lookup(entry, deviceId, capabilityId) is (var d, var c) =>
            LastChanged(entry, d, c),
        ({ } entry, "variable", var variableId, _) when entry.State.FindVariable(variableId) is { } v => Variable(entry, v),
        _ => null,
    };

    public bool? Knows(string signalId) =>
        Parse(signalId) is not ({ } entry, _, _, _) ? false
        : !entry.State.Loaded ? null
        : Find(signalId) is not null;

    public SignalReading Read(string signalId, RuleContext context)
    {
        if (Parse(signalId) is not ({ } entry, var kind, var id, var capabilityId)) return SignalReading.Missing;
        if (!entry.State.Loaded) return SignalReading.NoValue;
        switch (kind)
        {
            case "capability" or "changed":
                if (Lookup(entry, id, capabilityId) is not (_, var capability)) return SignalReading.Missing;
                if (kind == "changed") return SignalReading.Of(capability.LastUpdated);
                return Type(capability.Type) is { } type ? SignalReading.Of(Value(type, capability.Value)) : SignalReading.Missing;
            case "variable":
                if (entry.State.FindVariable(id) is not { } variable) return SignalReading.Missing;
                return Type(variable.Type) is { } variableType ? SignalReading.Of(Value(variableType, variable.Value)) : SignalReading.Missing;
            default:
                return SignalReading.Missing;
        }
    }

    // The account's Homey (null once the account is removed), what kind of signal, and its ids.
    private (Homeys.Entry? Entry, string Kind, string Id, string? CapabilityId)? Parse(string signalId)
    {
        if (!Owns(signalId)) return null;
        var parts = signalId.Split(':', 5);
        if (parts.Length < 4 || !int.TryParse(parts[1], out var account)) return null;
        return parts[2] switch
        {
            "capability" or "changed" when parts.Length == 5 => (_homeys.Find(account), parts[2], parts[3], parts[4]),
            "variable" when parts.Length == 4 => (_homeys.Find(account), parts[2], parts[3], null),
            _ => null,
        };
    }

    private static (HomeyDevice Device, HomeyCapability Capability)? Lookup(Homeys.Entry entry, string deviceId, string? capabilityId) =>
        entry.State.FindDevice(deviceId) is { } device && capabilityId is not null
        && device.Capabilities.TryGetValue(capabilityId, out var capability)
            ? (device, capability)
            : null;

    private static SignalInfo? Capability(Homeys.Entry entry, HomeyDevice device, HomeyCapability capability) =>
        Type(capability.Type) is { } type
            ? new SignalInfo($"{Prefix}{entry.AccountId}:capability:{device.Id}:{capability.Id}", "homey", type, capability.Title, device.Name)
            {
                Account = entry.AccountId,
                AccountName = entry.Name,
                AllowedValues = capability.Values?.Select(v => new AllowedValue(v.Id, v.Title)).ToList(),
                Unit = capability.Units,
                Min = capability.Min,
                Max = capability.Max,
                Step = capability.Step,
                TrueLabel = type == SignalType.YesNo ? BoolLabels(capability.Id).True : null,
                FalseLabel = type == SignalType.YesNo ? BoolLabels(capability.Id).False : null,
            }
            : null;

    private static SignalInfo? LastChanged(Homeys.Entry entry, HomeyDevice device, HomeyCapability capability) =>
        Type(capability.Type) is null ? null
        : new SignalInfo($"{Prefix}{entry.AccountId}:changed:{device.Id}:{capability.Id}", "homey", SignalType.DateTime,
            $"{capability.Title} last changed", device.Name)
        {
            Account = entry.AccountId,
            AccountName = entry.Name,
        };

    private static SignalInfo? Variable(Homeys.Entry entry, HomeyVariable variable) =>
        Type(variable.Type) is { } type
            ? new SignalInfo($"{Prefix}{entry.AccountId}:variable:{variable.Id}", "homey", type, variable.Name, "Variables")
            {
                Account = entry.AccountId,
                AccountName = entry.Name,
            }
            : null;

    // Other alarms are on or off; anything else is yes or no.
    private static (string True, string False) BoolLabels(string capabilityId) =>
        Labels.TryGetValue(capabilityId, out var labels) ? labels
        : capabilityId.StartsWith("alarm_", StringComparison.Ordinal) ? ("alarm", "no alarm")
        : ("yes", "no");

    // Homey's capability and variable types; others (such as colours as objects) are no signal.
    private static SignalType? Type(string homeyType) => homeyType switch
    {
        "boolean" => SignalType.YesNo,
        "number" => SignalType.Number,
        "string" or "enum" => SignalType.Text,
        _ => null,
    };

    private static object? Value(SignalType type, JsonElement value) => (type, value.ValueKind) switch
    {
        (SignalType.YesNo, JsonValueKind.True or JsonValueKind.False) => value.GetBoolean(),
        (SignalType.Number, JsonValueKind.Number) => value.GetDouble(),
        (SignalType.Text, JsonValueKind.String) => value.GetString(),
        _ => null,
    };

    private void OnHomeysChanged()
    {
        Listen();
        Changed?.Invoke();
    }

    private void Listen()
    {
        lock (_lock)
        {
            var current = _homeys.All.ToDictionary(e => e.AccountId, e => e.State);
            foreach (var (id, (state, handler)) in _listening.ToList())
            {
                if (current.GetValueOrDefault(id) == state) continue;
                state.Changed -= handler;
                _listening.Remove(id);
            }
            foreach (var (id, state) in current)
            {
                if (_listening.ContainsKey(id)) continue;
                Action<HomeyChange> handler = change =>
                {
                    // Only what can change a value, or make a signal come or go.
                    if (change is not CatalogChanged) Changed?.Invoke();
                };
                state.Changed += handler;
                _listening[id] = (state, handler);
            }
        }
    }

    public void Dispose()
    {
        _homeys.Changed -= OnHomeysChanged;
        lock (_lock)
        {
            foreach (var (state, handler) in _listening.Values) state.Changed -= handler;
            _listening.Clear();
        }
    }
}
