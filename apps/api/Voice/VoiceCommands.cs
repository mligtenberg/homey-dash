using System.Text.Json;
using HomeyDash.Api.Homey;

namespace HomeyDash.Api.Voice;

/// <summary>What the voice service asks for in a device: a capability to set, or (<c>..._delta</c>) a step from its current value.</summary>
public sealed record VoiceCommand(string Device, string Capability, JsonElement Value);

/// <summary>One capability to set in Homey. An optional one is a preparation, such as a light's mode, that may fail without the change failing.</summary>
public sealed record VoiceChange(string Device, string Capability, object Value, bool Optional = false);

public static class VoicePlan
{
    private const string Delta = "_delta";

    /// <summary>
    /// The changes a voice command comes to, given what the devices are now: a step becomes a new value within the range
    /// the device allows, a dimmed light is turned on, and a light's colour temperature (Homey: 0 cool, 1 warm) first puts
    /// the light in temperature mode unless it is. A step on a device with no known value is left out.
    /// </summary>
    public static IReadOnlyList<VoiceChange> Plan(IEnumerable<VoiceCommand> commands, Func<string, HomeyDevice?> find)
    {
        var changes = new List<VoiceChange>();
        foreach (var (deviceId, capability, value) in commands)
        {
            var caps = find(deviceId)?.Capabilities;
            if (!capability.EndsWith(Delta, StringComparison.Ordinal))
            {
                changes.Add(new VoiceChange(deviceId, capability, Plain(value)));
                if (capability == "dim" && value.ValueKind == JsonValueKind.Number && value.GetDouble() > 0 && caps?.ContainsKey("onoff") == true)
                    changes.Add(new VoiceChange(deviceId, "onoff", true));
                continue;
            }

            var target = capability[..^Delta.Length];
            if (caps?.GetValueOrDefault(target) is not { } current || current.Value.ValueKind != JsonValueKind.Number
                || value.ValueKind != JsonValueKind.Number) continue;
            var light = target == "light_temperature";
            var min = current.Min ?? (light ? 0 : double.NegativeInfinity);
            var max = current.Max ?? (light ? 1 : double.PositiveInfinity);
            var next = Math.Clamp(current.Value.GetDouble() + value.GetDouble(), min, max);
            if (current.Step is > 0 and var step) next = Math.Round(next / step) * step;
            if (light && caps.GetValueOrDefault("light_mode") is { } mode && mode.Value.ValueKind == JsonValueKind.String && mode.Value.GetString() != "temperature")
                changes.Add(new VoiceChange(deviceId, "light_mode", "temperature", Optional: true));
            changes.Add(new VoiceChange(deviceId, target, Math.Round(next, 3)));
        }
        return changes;
    }

    private static object Plain(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Number => value.GetDouble(),
        _ => value.ToString(),
    };
}
