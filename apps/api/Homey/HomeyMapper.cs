using System.Text.Json;

namespace HomeyDash.Api.Homey;

// Maps the JSON of Homey's local API (v3) onto HomeyDash's models.
public static class HomeyMapper
{
    public static HomeyDevice Device(JsonElement json, IReadOnlyDictionary<string, string> zoneNames)
    {
        var zoneId = String(json, "zone");
        var capabilities = new Dictionary<string, HomeyCapability>();
        if (json.TryGetProperty("capabilitiesObj", out var objs) && objs.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in objs.EnumerateObject())
            {
                capabilities[property.Name] = Capability(property.Name, property.Value);
            }
        }

        return new HomeyDevice(
            Id: String(json, "id") ?? throw new JsonException("Device without id"),
            Name: String(json, "name") ?? "",
            ZoneId: zoneId,
            ZoneName: zoneId is null ? null : zoneNames.GetValueOrDefault(zoneId),
            Class: String(json, "virtualClass") ?? String(json, "class") ?? "other",
            Available: Bool(json, "available") ?? true,
            UnavailableMessage: String(json, "unavailableMessage"),
            Capabilities: capabilities);
    }

    public static HomeyCapability Capability(string id, JsonElement json) => new(
        Id: id,
        Title: String(json, "title") ?? id,
        Type: String(json, "type") ?? "string",
        Value: json.TryGetProperty("value", out var value) ? value.Clone() : default,
        Units: String(json, "units"),
        Setable: Bool(json, "setable") ?? false,
        Getable: Bool(json, "getable") ?? true,
        Min: Number(json, "min"),
        Max: Number(json, "max"),
        Step: Number(json, "step"),
        LastUpdated: Date(json, "lastUpdated"));

    public static HomeyFlow Flow(JsonElement json, bool advanced) => new(
        Id: String(json, "id") ?? throw new JsonException("Flow without id"),
        Name: String(json, "name") ?? "",
        Advanced: advanced,
        Enabled: Bool(json, "enabled") ?? true,
        FolderId: String(json, "folder"));

    public static HomeyFlowFolder FlowFolder(JsonElement json) => new(
        Id: String(json, "id") ?? throw new JsonException("Flow folder without id"),
        Name: String(json, "name") ?? "",
        ParentId: String(json, "parent"));

    public static HomeyZone Zone(JsonElement json) => new(
        Id: String(json, "id") ?? throw new JsonException("Zone without id"),
        Name: String(json, "name") ?? "",
        ParentId: String(json, "parent"));

    public static HomeyMood Mood(JsonElement json) => new(
        Id: String(json, "id") ?? throw new JsonException("Mood without id"),
        Name: String(json, "name") ?? "",
        ZoneId: String(json, "zone"),
        Colors: json.TryGetProperty("devices", out var devices)
            ? Values(devices).Select(d => d.TryGetProperty("state", out var state) ? LightColor(state) : null).OfType<HomeyLightColor>().ToList()
            : []);

    // A mood's light state, { onoff, dim, light_mode, light_hue, light_saturation, light_temperature }: the colour it
    // sets, or null when it turns the light off or sets no colour. Without light_mode a hue means colour mode.
    private static HomeyLightColor? LightColor(JsonElement state)
    {
        if (Bool(state, "onoff") == false) return null;
        var mode = String(state, "light_mode");
        if (Number(state, "light_hue") is { } hue && mode is "color" or null)
            return new HomeyLightColor(hue, Number(state, "light_saturation") ?? 1, null);
        return Number(state, "light_temperature") is { } temperature && mode is "temperature" or null
            ? new HomeyLightColor(null, null, temperature)
            : null;
    }

    public static HomeyInsightLog InsightLog(JsonElement json) => new(
        Id: String(json, "id") ?? throw new JsonException("Insight log without id"),
        OwnerUri: String(json, "ownerUri") ?? String(json, "uri") ?? "",
        OwnerName: String(json, "ownerName"),
        Title: String(json, "title") ?? "",
        Type: String(json, "type") ?? "number",
        Units: String(json, "units"));

    // Homey answers { values: [{ t, v }], step, start, end, lastValue }.
    public static List<HomeyInsightEntry> InsightEntries(JsonElement json) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty("values", out var values) && values.ValueKind == JsonValueKind.Array
            ? values.EnumerateArray()
                .Select(v => Date(v, "t") is { } t
                    ? new HomeyInsightEntry(t, v.TryGetProperty("v", out var n) && n.ValueKind == JsonValueKind.Number ? n.GetDouble() : null)
                    : null)
                .OfType<HomeyInsightEntry>()
                .OrderBy(e => e.T)
                .ToList()
            : [];

    // Homey returns collections as objects keyed by id.
    public static IEnumerable<JsonElement> Values(JsonElement json) => json.ValueKind switch
    {
        JsonValueKind.Object => json.EnumerateObject().Select(p => p.Value),
        JsonValueKind.Array => json.EnumerateArray(),
        _ => [],
    };

    public static string? String(JsonElement json, string name) =>
        json.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static bool? Bool(JsonElement json, string name) =>
        json.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? v.GetBoolean()
            : null;

    private static double? Number(JsonElement json, string name) =>
        json.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    public static DateTimeOffset? Date(JsonElement json, string name) =>
        json.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(v.GetString(), out var d)
            ? d
            : null;
}
