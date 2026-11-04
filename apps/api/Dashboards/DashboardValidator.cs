using System.Text.RegularExpressions;

namespace HomeyDash.Api.Dashboards;

/// <summary>
/// Checks a dashboard version against the layout rules (ADR-0005): tiles stay inside their section's
/// grid and never overlap. Mirrors libs/layout/src/lib/section-grid.ts.
/// </summary>
/// <remarks>
/// Which sizes a tile kind supports is declared by its module in the front end (ADR-0003), so
/// Management checks that; the API only knows the fixed set of sizes.
/// </remarks>
public static partial class DashboardValidator
{
    public const int SectionColumns = 3;
    public const int MaxRows = 12;
    public const int MaxNameLength = 100;

    public static (int Columns, int Rows) Span(TileSize size) => size switch
    {
        TileSize.Small => (1, 1),
        TileSize.Wide => (2, 1),
        TileSize.Full => (3, 1),
        TileSize.Large => (2, 2),
        TileSize.FullLarge => (3, 2),
        _ => throw new ArgumentOutOfRangeException(nameof(size), size, "Unknown tile size"),
    };

    // Problems keyed by where they are, e.g. "sections[0].tiles[2]", as a validation problem expects.
    public static Dictionary<string, string[]> Validate(DashboardLayout layout)
    {
        var errors = new Dictionary<string, List<string>>();
        void Add(string key, string message)
        {
            if (!errors.TryGetValue(key, out var list)) errors[key] = list = [];
            list.Add(message);
        }

        if (layout.Rows is < 1 or > MaxRows)
            Add("rows", $"A dashboard has 1 to {MaxRows} rows, not {layout.Rows}.");

        if (layout.Background is { } background)
        {
            if (!DashboardBackground.Kinds.Contains(background.Kind))
                Add("background.kind", $"A background is one of {string.Join(", ", DashboardBackground.Kinds)}.");
            var colours = background.Kind switch { "color" => 1, "gradient" => 2, _ => 0 };
            foreach (var (name, colour) in new[] { ("color", background.Color), ("to", background.To) }.Take(colours))
                if (colour is null || !HexColor().IsMatch(colour))
                    Add($"background.{name}", "A colour is written as #rrggbb, such as #1a1c24.");
            if (background.Kind == "gradient" && background.Angle is not (>= 0 and < 360))
                Add("background.angle", "A gradient's angle is 0 to 359 degrees.");
            if (background.Kind == "image" && background.ImageId is null)
                Add("background.imageId", "An image background needs an uploaded image.");
            if (background.Kind == "preset" && (background.Preset is null || !PresetName().IsMatch(background.Preset)))
                Add("background.preset", "A built-in background is named <style>/<subject>, such as geometric/living-room.");
        }

        // Collections and positions can still be null when the JSON left them out.
        if (layout.Sections is null)
        {
            Add("sections", "A dashboard needs a list of sections.");
            return Done();
        }

        var sectionIds = new HashSet<string>();
        var tileIds = new HashSet<string>();
        for (var s = 0; s < layout.Sections.Count; s++)
        {
            var section = layout.Sections[s];
            var sectionKey = $"sections[{s}]";
            if (string.IsNullOrWhiteSpace(section.Id) || !sectionIds.Add(section.Id))
                Add(sectionKey, "A section needs an id that no other section has.");

            if (section.Tiles is null)
            {
                Add(sectionKey, "A section needs a list of tiles.");
                continue;
            }

            var owner = new Dictionary<(int, int), string>();
            for (var t = 0; t < section.Tiles.Count; t++)
            {
                var tile = section.Tiles[t];
                var key = $"{sectionKey}.tiles[{t}]";
                if (string.IsNullOrWhiteSpace(tile.Id) || !tileIds.Add(tile.Id))
                    Add(key, "A tile needs an id that no other tile has.");
                if (string.IsNullOrWhiteSpace(tile.Kind))
                    Add(key, "A tile needs a kind.");
                if (tile.Position is null || !Enum.IsDefined(tile.Size))
                {
                    Add(key, "A tile needs a known size and a position.");
                    continue;
                }

                var (columns, rows) = Span(tile.Size);
                var (column, row) = (tile.Position.Column, tile.Position.Row);
                if (column < 0 || row < 0 || column + columns > SectionColumns || row + rows > layout.Rows)
                {
                    Add(key, "The tile extends beyond its section's grid.");
                    continue;
                }

                var overlapping = new HashSet<string>();
                for (var c = column; c < column + columns; c++)
                for (var r = row; r < row + rows; r++)
                {
                    if (owner.TryGetValue((c, r), out var other)) overlapping.Add(other);
                    else owner[(c, r)] = tile.Id;
                }
                foreach (var other in overlapping)
                    Add(key, $"The tile overlaps tile {other}.");
            }
        }

        return Done();

        Dictionary<string, string[]> Done() => errors.ToDictionary(e => e.Key, e => e.Value.ToArray());
    }

    public static string? ValidateName(string? name) =>
        string.IsNullOrWhiteSpace(name) ? "A dashboard needs a name."
        : name.Trim().Length > MaxNameLength ? $"A dashboard name has at most {MaxNameLength} characters."
        : null;

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();

    [GeneratedRegex("^[a-z0-9-]+/[a-z0-9-]+$")]
    private static partial Regex PresetName();
}
