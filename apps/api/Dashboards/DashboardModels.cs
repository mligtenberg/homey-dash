using System.Text.Json;
using System.Text.Json.Serialization;

namespace HomeyDash.Api.Dashboards;

// A dashboard version (draft or published) as stored and sent over the API.
// Mirrored in libs/api-client/src/lib/dashboards.ts; sizes and the grid in libs/layout.

public enum TileSize
{
    Small,
    Wide,
    Full,
    Large,
    [JsonStringEnumMemberName("full-large")] FullLarge,
}

public sealed record TilePosition(int Column, int Row);

// Settings belong to the tile's kind (ADR-0003), so the API stores them without looking inside.
public sealed record Tile(string Id, string Kind, TileSize Size, TilePosition Position, JsonElement Settings);

// A hidden section stays in the editor but displays leave it out; one with a rule (ADR-0010) is shown while it holds.
// The rule stays JSON so a broken one is reported where it is, as a logic tile's is.
public sealed record Section(string Id, string Title, IReadOnlyList<Tile> Tiles, bool Hidden = false, JsonElement? Rule = null);

// Rows are part of the version: changing them in the draft must not break the published layout.
public sealed record DashboardLayout(int Rows, IReadOnlyList<Section> Sections)
{
    public const int DefaultRows = 4;

    public static DashboardLayout Empty { get; } = new(DefaultRows, []);
}

public sealed record DashboardSummary(
    Guid Id,
    string Name,
    int PublishedVersion,
    DateTimeOffset? PublishedAt,
    bool HasUnpublishedChanges,
    int MissingTiles);

public sealed record DashboardDetail(
    Guid Id,
    string Name,
    DashboardLayout Draft,
    DashboardLayout? Published,
    int PublishedVersion,
    DateTimeOffset? PublishedAt,
    bool HasUnpublishedChanges,
    int MissingTiles);
