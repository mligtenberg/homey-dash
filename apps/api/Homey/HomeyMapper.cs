using System.Globalization;
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

    public static HomeyUser User(JsonElement json) => new(
        Id: String(json, "id") ?? throw new JsonException("User without id"),
        Name: String(json, "name") ?? "",
        Present: Bool(json, "present") ?? true,
        Asleep: Bool(json, "asleep") ?? false);

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
    // As a Homey Pro (2023) answers GET api/manager/energy/live and report/day; Homey does not document them.

    // The live report: { totalCumulative: { W }, totalGenerated: { W }, totalConsumed: { W }, items: [...] }. The cumulative
    // figure is the energy meter's (a P1 meter): the grid, negative while exporting. Consumed only adds up the devices that
    // measure or estimate their own power, so it is the home's use only without a meter. Null when it holds no power at all.
    public static EnergyLive? EnergyLive(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object) return null;
        var grid = Watts(json, "totalCumulative");
        var solar = Watts(json, "totalGenerated");
        var home = grid is null ? Watts(json, "totalConsumed") : grid + (solar ?? 0);
        return home is null && solar is null && grid is null ? null : new EnergyLive(grid, solar, home);
    }

    // The day report: { electricity: { importedPeriod, exportedPeriod, generatedPeriod, consumedPeriod, importedPrice,
    // exportedPrice, cumulativeMeasurePower: [{ t, v }], devices: { consumed: { id: { name, period } } } }, subReports: {
    // "<hour start>": { electricity: {...Period} } } }, in kWh and the currency Homey is set to. The home's use is what came in
    // from the grid, less what went out, plus what the sun made; without a meter, what the devices add up to. Null when it
    // holds none of it.
    public static EnergyDay? EnergyDay(JsonElement json, string? currency = null)
    {
        if (json.ValueKind != JsonValueKind.Object || !json.TryGetProperty("electricity", out var power) || power.ValueKind != JsonValueKind.Object)
            return null;
        var (imported, exported, solar, home) = Periods(power);
        var importedCost = Number(power, "importedPrice");
        var cost = importedCost is null ? null : importedCost - (Number(power, "exportedPrice") ?? 0);

        var history = new List<EnergyPoint>();
        if (json.TryGetProperty("subReports", out var hours) && hours.ValueKind == JsonValueKind.Object)
            foreach (var hour in hours.EnumerateObject())
            {
                if (!TryMoment(hour.Name, out var at) || !hour.Value.TryGetProperty("electricity", out var inHour)) continue;
                var (_, _, hourSolar, hourHome) = Periods(inHour);
                history.Add(new EnergyPoint(at, hourHome, hourSolar));
            }
        history.Sort((x, y) => x.T.CompareTo(y.T));

        var readings = new List<EnergyReading>();
        if (power.TryGetProperty("cumulativeMeasurePower", out var curve) && curve.ValueKind == JsonValueKind.Array)
            foreach (var reading in curve.EnumerateArray())
                if (reading.ValueKind == JsonValueKind.Object && String(reading, "t") is { } t && TryMoment(t, out var at))
                    readings.Add(new EnergyReading(at, Number(reading, "v")));
        readings.Sort((x, y) => x.T.CompareTo(y.T));

        var devices = new List<EnergyUse>();
        if (power.TryGetProperty("devices", out var byKind) && byKind.ValueKind == JsonValueKind.Object
            && byKind.TryGetProperty("consumed", out var consumed) && consumed.ValueKind == JsonValueKind.Object)
            devices = consumed.EnumerateObject()
                .Select(d => (Name: String(d.Value, "name"), Kwh: Number(d.Value, "period")))
                .Where(d => d.Name is not null && d.Kwh > 0)
                .OrderByDescending(d => d.Kwh)
                .Take(EnergyDevices)
                .Select(d => new EnergyUse(d.Name!, d.Kwh!.Value))
                .ToList();

        return imported is null && exported is null && solar is null && home is null && history.Count == 0
            ? null
            : new EnergyDay(imported, exported, solar, home, cost, currency, history, readings, devices);
    }

    // How many of the devices that used the most today the report keeps.
    public const int EnergyDevices = 8;

    // A period's imported, exported and generated kWh, and the home's use from them.
    private static (double? Imported, double? Exported, double? Solar, double? Home) Periods(JsonElement power)
    {
        var imported = Number(power, "importedPeriod");
        var exported = Number(power, "exportedPeriod");
        var solar = Number(power, "generatedPeriod");
        var home = imported is null ? Number(power, "consumedPeriod") : imported - (exported ?? 0) + (solar ?? 0);
        return (imported, exported, solar, home is < 0 ? 0 : home);
    }

    // The watts of { W: 1362 }, null when Homey has none.
    private static double? Watts(JsonElement json, string name) =>
        json.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Object ? Number(v, "W") : null;

    private static bool TryMoment(string text, out DateTimeOffset at) =>
        DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out at);

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
