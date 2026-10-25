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

    public DashboardSummary ToSummary() => new(Id, Name, PublishedVersion, PublishedAt, HasUnpublishedChanges);

    public DashboardDetail ToDetail() =>
        new(Id, Name, Draft, Published, PublishedVersion, PublishedAt, HasUnpublishedChanges);
}
