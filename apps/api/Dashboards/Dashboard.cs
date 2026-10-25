using System.Text.Json;
using System.Text.Json.Serialization;
using HomeyDash.Api.Homey;

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

    // Draft tiles whose target (settings.target) Homey does not know; 0 while Homey is not loaded.
    public int MissingTiles(HomeyState homey) =>
        !homey.Loaded
            ? 0
            : Draft.Sections.SelectMany(s => s.Tiles).Count(t =>
                t.Settings.ValueKind == JsonValueKind.Object
                && t.Settings.TryGetProperty("target", out var target)
                && target.ValueKind == JsonValueKind.String
                && !homey.Knows(target.GetString()!));

    public DashboardSummary ToSummary(HomeyState homey) =>
        new(Id, Name, PublishedVersion, PublishedAt, HasUnpublishedChanges, MissingTiles(homey));

    public DashboardDetail ToDetail(HomeyState homey) =>
        new(Id, Name, Draft, Published, PublishedVersion, PublishedAt, HasUnpublishedChanges, MissingTiles(homey));
}
