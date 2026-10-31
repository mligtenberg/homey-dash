using System.Text.Json;
using System.Text.Json.Serialization;
using HomeyDash.Api.Rules;

namespace HomeyDash.Api.Dashboards;

/// <summary>
/// A named layout of tiles with one draft and at most one published version. Both versions are
/// stored as JSON documents, so new tile kinds need no migration.
/// </summary>
public sealed class Dashboard
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string Name { get; set; }
    public DashboardLayout Draft { get; private set; } = DashboardLayout.Empty;
    public DashboardLayout? Published { get; private set; }

    // Counts publishes, so a display can tell whether it shows the latest version. 0 = never published.
    public int PublishedVersion { get; private set; }
    public DateTimeOffset? PublishedAt { get; private set; }

    public static JsonSerializerOptions Json { get; } = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public bool HasUnpublishedChanges =>
        Published is null || JsonSerializer.Serialize(Draft, Json) != JsonSerializer.Serialize(Published, Json);

    public void SaveDraft(DashboardLayout draft) => Draft = draft;

    public void Publish(DateTimeOffset now)
    {
        Published = Draft;
        PublishedVersion++;
        PublishedAt = now;
    }

    // Draft tiles with a target (settings.target, or one of settings.targets) that no longer exists in their account,
    // and logic tiles holding such a tile or with a condition on a signal that no longer exists.
    public int MissingTiles(TargetCatalog targets) =>
        Draft.Sections.SelectMany(s => s.Tiles).Count(t => Missing(t.Settings, targets)
            || t.Kind == LogicTiles.Kind && (LogicTiles.Held(t.Settings).Any(held => Missing(held, targets))
                || LogicTiles.Signals(t.Settings).Any(signal => targets.KnowsSignal(signal) == false)));

    private static bool Missing(JsonElement settings, TargetCatalog targets) =>
        Targets(settings).Any(target => targets.Knows(target, Account(settings)) == false);

    // The account a tile's settings name (settings.account); null for the oldest account of its kind.
    public static int? Account(JsonElement settings) =>
        settings.ValueKind == JsonValueKind.Object && settings.TryGetProperty("account", out var account)
        && account.ValueKind == JsonValueKind.Number && account.TryGetInt32(out var id) ? id : null;

    // Every target the draft's tiles point at, including those of the tiles logic tiles hold.
    public IEnumerable<string> Targets() => Draft.Sections.SelectMany(s => s.Tiles).SelectMany(t =>
        Targets(t.Settings).Concat(t.Kind == LogicTiles.Kind ? LogicTiles.Held(t.Settings).SelectMany(Targets) : []));

    private static IEnumerable<string> Targets(JsonElement settings)
    {
        if (settings.ValueKind != JsonValueKind.Object) yield break;
        if (settings.TryGetProperty("target", out var target) && target.ValueKind == JsonValueKind.String)
            yield return target.GetString()!;
        if (settings.TryGetProperty("targets", out var targets) && targets.ValueKind == JsonValueKind.Array)
            foreach (var item in targets.EnumerateArray())
                if (item.ValueKind == JsonValueKind.String)
                    yield return item.GetString()!;
    }

    public DashboardSummary ToSummary(TargetCatalog targets) =>
        new(Id, Name, PublishedVersion, PublishedAt, HasUnpublishedChanges, MissingTiles(targets));

    public DashboardDetail ToDetail(TargetCatalog targets) =>
        new(Id, Name, Draft, Published, PublishedVersion, PublishedAt, HasUnpublishedChanges, MissingTiles(targets));
}
