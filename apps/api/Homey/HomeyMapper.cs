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
            Capabilities: capabilities)
        {
            AlbumArt = AlbumArt(json),
        };
    }

    // Homey lists a device's pictures as images: [{ id, type, imageObj: { id, url, lastUpdated } }]; album art is
    // the one of type media.
    private static HomeyImage? AlbumArt(JsonElement json)
    {
        if (!json.TryGetProperty("images", out var images)) return null;
        var media = Values(images).FirstOrDefault(i => i.ValueKind == JsonValueKind.Object && String(i, "type") == "media");
        return media.ValueKind == JsonValueKind.Object && media.TryGetProperty("imageObj", out var image) && String(image, "id") is { } id
            ? new HomeyImage(id, ImageVersion(image))
            : null;
    }

    // When a picture last changed, which Homey gives as a date or a number of milliseconds.
    public static string? ImageVersion(JsonElement image) =>
        image.TryGetProperty("lastUpdated", out var v)
            ? v.ValueKind switch { JsonValueKind.String => v.GetString(), JsonValueKind.Number => v.GetRawText(), _ => null }
            : null;

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
        LastUpdated: Date(json, "lastUpdated"))
    {
        Values = json.TryGetProperty("values", out var values) && values.ValueKind == JsonValueKind.Array
            ? values.EnumerateArray()
                .Select(v => String(v, "id") is { } id ? new HomeyEnumValue(id, String(v, "title") ?? id) : null)
                .OfType<HomeyEnumValue>()
                .ToList()
            : null,
    };

    public static HomeyVariable Variable(JsonElement json) => new(
        Id: String(json, "id") ?? throw new JsonException("Variable without id"),
        Name: String(json, "name") ?? "",
        Type: String(json, "type") ?? "string",
        Value: json.TryGetProperty("value", out var value) ? value.Clone() : default);

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

    // Homey's own weather, { city, temperature, humidity, state, ... }; read leniently, as Homey doesn't document it.
    // Humidity comes as a fraction or a percentage, and is kept as a fraction.
    public static HomeyWeather Weather(JsonElement json)
    {
        if (json.TryGetProperty("current", out var current) && current.ValueKind == JsonValueKind.Object) json = current;
        var humidity = Number(json, "humidity");
        return new HomeyWeather(
            Temperature: Number(json, "temperature"),
            State: String(json, "state") ?? String(json, "condition"),
            Humidity: humidity > 1 ? humidity / 100 : humidity,
            City: String(json, "city"));
    }

    // ---- Homey's energy report (ADR-0014). ----
    // Homey does not document the shape of GET api/manager/energy/live and report/day, and this was written without seeing
    // one: both are read leniently, every figure under any of the names it plausibly has, as a number or as an object holding
    // one ({ W: 1450 }, { kWh: 8.2 }). Check it against a real response, and fix only here.

    private static readonly string[] ConsumedNames = ["totalConsumed", "consumed", "consumption", "homeConsumption", "home"];
    private static readonly string[] GeneratedNames = ["totalGenerated", "generated", "solar", "production", "produced"];

    // The live report: power now, in watts. Null when it holds none of it, as for a Homey without energy.
    public static EnergyLive? EnergyLive(JsonElement json)
    {
        json = EnergyBody(json);
        var home = Quantity(json, ConsumedNames);
        var solar = Quantity(json, GeneratedNames);
        // Positive imports. Homey reports no grid figure of its own that we know of: it is what the home uses beyond what it makes.
        var grid = Quantity(json, "grid", "gridPower", "net", "netPower") ?? (home is null ? null : home - (solar ?? 0));
        return home is null && solar is null && grid is null ? null : new EnergyLive(grid, solar, home);
    }

    // The day report: totals in kWh, and the day by the step it gives. Null when it holds none of it.
    public static EnergyDay? EnergyDay(JsonElement json)
    {
        json = EnergyBody(json);
        var totals = json;
        foreach (var name in new[] { "totals", "total", "cumulative", "cumulatives" })
            if (json.TryGetProperty(name, out var inner) && inner.ValueKind == JsonValueKind.Object) totals = inner;
        var home = Quantity(totals, ConsumedNames);
        var solar = Quantity(totals, GeneratedNames);
        var imported = Quantity(totals, "totalImported", "imported", "import");
        var exported = Quantity(totals, "totalExported", "exported", "export");
        var history = new List<EnergyPoint>();
        foreach (var name in new[] { "history", "values", "data", "series", "hours", "items", "entries" })
        {
            if (!json.TryGetProperty(name, out var list) || list.ValueKind != JsonValueKind.Array) continue;
            foreach (var entry in list.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.Object))
            {
                var at = new[] { "t", "time", "from", "start", "date", "timestamp" }.Select(n => Moment(entry, n)).FirstOrDefault(d => d is not null);
                if (at is null) continue;
                history.Add(new EnergyPoint(at.Value, Quantity(entry, ConsumedNames), Quantity(entry, GeneratedNames)));
            }
            if (history.Count > 0) break;
        }
        history.Sort((a, b) => a.T.CompareTo(b.T));
        return home is null && solar is null && imported is null && exported is null && history.Count == 0
            ? null
            : new EnergyDay(imported, exported, solar, home, history);
    }

    // The report itself, which may come wrapped as { report: {...} } or { data: {...} }.
    private static JsonElement EnergyBody(JsonElement json)
    {
        foreach (var name in new[] { "report", "data", "result" })
            if (json.ValueKind == JsonValueKind.Object && json.TryGetProperty(name, out var inner) && inner.ValueKind == JsonValueKind.Object) return inner;
        return json;
    }

    // A figure under the first of these names that has one: a number, or an object holding one as W, kWh, value or total.
    private static double? Quantity(JsonElement json, params string[] names)
    {
        if (json.ValueKind != JsonValueKind.Object) return null;
        foreach (var name in names)
        {
            if (!json.TryGetProperty(name, out var v)) continue;
            if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
            if (v.ValueKind != JsonValueKind.Object) continue;
            foreach (var unit in new[] { "W", "kWh", "value", "total", "power" })
                if (v.TryGetProperty(unit, out var n) && n.ValueKind == JsonValueKind.Number) return n.GetDouble();
        }
        return null;
    }

    // A moment as an ISO date-time or as epoch milliseconds or seconds.
    private static DateTimeOffset? Moment(JsonElement json, string name)
    {
        if (!json.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var epoch))
            return epoch > 100_000_000_000 ? DateTimeOffset.FromUnixTimeMilliseconds(epoch) : DateTimeOffset.FromUnixTimeSeconds(epoch);
        return v.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(v.GetString(), out var d) ? d : null;
    }

    // Homey's location option, { value: { latitude, longitude, ... } } or the location itself; null when it has none.
    public static HomeyLocation? Location(JsonElement json)
    {
        if (json.TryGetProperty("value", out var value) && value.ValueKind == JsonValueKind.Object) json = value;
        if (json.ValueKind != JsonValueKind.Object) return null;
        var latitude = Number(json, "latitude") ?? Number(json, "lat");
        var longitude = Number(json, "longitude") ?? Number(json, "lng") ?? Number(json, "lon");
        return latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180 && (latitude, longitude) != (0, 0)
            ? new HomeyLocation(latitude.Value, longitude.Value)
            : null;
    }

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
