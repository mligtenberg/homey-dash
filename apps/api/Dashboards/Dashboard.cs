using System.Text.Json;
using System.Text.Json.Serialization;

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

    // Draft tiles with a target (settings.target, or one of settings.targets) that no longer exists.
    public int MissingTiles(TargetCatalog targets) =>
        Draft.Sections.SelectMany(s => s.Tiles).Count(t => Targets(t.Settings).Any(target => targets.Knows(target) == false));

    // Every target the draft's tiles point at.
    public IEnumerable<string> Targets() => Draft.Sections.SelectMany(s => s.Tiles).SelectMany(t => Targets(t.Settings));

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
