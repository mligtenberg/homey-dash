using System.Text.Json;
using HomeyDash.Api.Dashboards;

namespace HomeyDash.Api.Rules;

/// <summary>
/// The one place the API looks inside a tile kind's settings (ADR-0010): a logic tile's rules, to validate them on save
/// and flag those on missing signals, and the targets of the tiles it holds, to flag those too. The tiles it holds stay
/// opaque otherwise. Its settings are <c>{ entries: [{ tile: { kind, settings }, rule }], fallback: { kind, settings } |
/// null, minShowSeconds }</c>; mirrored in libs/tiles/src/lib/logic/logic-tile.ts.
/// </summary>
public static class LogicTiles
{
    public const string Kind = "logic";

    // Each entry's rule, keyed by where it is in the settings, such as "entries[1].rule"; undefined where one has none.
    public static IEnumerable<(string Key, JsonElement Rule)> Rules(JsonElement settings) =>
        Entries(settings).Select((entry, i) => ($"entries[{i}].rule",
            entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("rule", out var rule) ? rule : default));

    // The settings of every tile it holds, the fallback last.
    public static IEnumerable<JsonElement> Held(JsonElement settings) => HeldTiles(settings).Select(t => t.Settings);

    // The kind and settings of every tile it holds, the fallback last.
    public static IEnumerable<(string? Kind, JsonElement Settings)> HeldTiles(JsonElement settings)
    {
        foreach (var entry in Entries(settings))
            if (entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("tile", out var tile) && TileSettings(tile) is { } held)
                yield return (KindOf(tile), held);
        if (settings.ValueKind == JsonValueKind.Object && settings.TryGetProperty("fallback", out var fallback)
            && TileSettings(fallback) is { } fallbackSettings)
            yield return (KindOf(fallback), fallbackSettings);
    }

    // Every signal its rules use.
    public static IEnumerable<string> Signals(JsonElement settings) =>
        Rules(settings).SelectMany(r => RuleEngine.Parse(r.Rule).Rule?.AllConditions() ?? [])
            .Select(c => c.Signal)
            .OfType<string>();

    /// <summary>What is wrong with the rules of a draft's logic tiles, keyed as the layout's validation keys its problems.</summary>
    public static Dictionary<string, string[]> Validate(DashboardLayout layout, RuleEngine engine)
    {
        var errors = new Dictionary<string, List<string>>();
        for (var s = 0; s < (layout.Sections?.Count ?? 0); s++)
        for (var t = 0; t < (layout.Sections![s].Tiles?.Count ?? 0); t++)
        {
            var tile = layout.Sections[s].Tiles[t];
            if (tile.Kind != Kind) continue;
            foreach (var (key, json) in Rules(tile.Settings))
            {
                var where = $"sections[{s}].tiles[{t}].settings.{key}";
                if (json.ValueKind == JsonValueKind.Undefined)
                {
                    Add(where, "Every tile a logic tile holds needs a rule.");
                    continue;
                }
                var (rule, error) = RuleEngine.Parse(json);
                if (rule is null)
                {
                    Add(where, error!);
                    continue;
                }
                foreach (var (conditionKey, message) in engine.Validate(rule)) Add($"{where}.{conditionKey}", message);
            }
        }
        return errors.ToDictionary(e => e.Key, e => e.Value.ToArray());

        void Add(string key, string message)
        {
            if (!errors.TryGetValue(key, out var list)) errors[key] = list = [];
            list.Add(message);
        }
    }

    private static IEnumerable<JsonElement> Entries(JsonElement settings) =>
        settings.ValueKind == JsonValueKind.Object && settings.TryGetProperty("entries", out var entries) && entries.ValueKind == JsonValueKind.Array
            ? entries.EnumerateArray()
            : [];

    private static string? KindOf(JsonElement tile) =>
        tile.TryGetProperty("kind", out var kind) && kind.ValueKind == JsonValueKind.String ? kind.GetString() : null;

    private static JsonElement? TileSettings(JsonElement tile) =>
        tile.ValueKind == JsonValueKind.Object && tile.TryGetProperty("settings", out var settings) && settings.ValueKind == JsonValueKind.Object
            ? settings
            : null;
}
