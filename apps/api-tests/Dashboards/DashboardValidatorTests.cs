using System.Text.Json;
using HomeyDash.Api.Dashboards;

namespace HomeyDash.Api.Tests.Dashboards;

public class DashboardValidatorTests
{
    private static Tile Tile(string id, int column, int row, TileSize size) =>
        new(id, "device", size, new TilePosition(column, row), JsonSerializer.SerializeToElement(new { }));

    private static DashboardLayout Layout(params Tile[] tiles) => new(4, [new Section("s1", "Living room", tiles)]);

    [Fact]
    public void ASectionWithEmptyCellsBetweenTiles_IsValid()
    {
        var layout = Layout(Tile("a", 0, 0, TileSize.Large), Tile("b", 2, 0, TileSize.Small), Tile("c", 0, 2, TileSize.FullLarge));

        Assert.Empty(DashboardValidator.Validate(layout));
    }

    [Theory]
    [InlineData(2, 0, TileSize.Wide)] // past the last column
    [InlineData(0, 3, TileSize.Large)] // below the last row
    [InlineData(-1, 0, TileSize.Small)]
    public void ATileBeyondTheGrid_IsRejected(int column, int row, TileSize size)
    {
        var errors = DashboardValidator.Validate(Layout(Tile("a", column, row, size)));

        Assert.Equal(["The tile extends beyond its section's grid."], errors["sections[0].tiles[0]"]);
    }

    [Fact]
    public void AnOverlappingTile_IsReportedOnce()
    {
        var errors = DashboardValidator.Validate(Layout(Tile("a", 0, 0, TileSize.Large), Tile("b", 1, 1, TileSize.Wide)));

        Assert.Equal(["The tile overlaps tile a."], errors["sections[0].tiles[1]"]);
        Assert.Single(errors);
    }

    [Fact]
    public void TilesInDifferentSections_DoNotOverlap()
    {
        var layout = new DashboardLayout(4,
        [
            new Section("s1", "", [Tile("a", 0, 0, TileSize.Full)]),
            new Section("s2", "", [Tile("b", 0, 0, TileSize.Full)]),
        ]);

        Assert.Empty(DashboardValidator.Validate(layout));
    }

    [Fact]
    public void DuplicateIds_AreRejected()
    {
        var layout = new DashboardLayout(4,
        [
            new Section("s1", "", [Tile("a", 0, 0, TileSize.Small)]),
            new Section("s1", "", [Tile("a", 0, 0, TileSize.Small)]),
        ]);

        var errors = DashboardValidator.Validate(layout);

        Assert.Contains("sections[1]", errors.Keys);
        Assert.Contains("sections[1].tiles[0]", errors.Keys);
    }

    [Fact]
    public void FewerRows_MakeTilesFallOffTheGrid()
    {
        var errors = DashboardValidator.Validate(Layout(Tile("a", 0, 3, TileSize.Small)) with { Rows = 3 });

        Assert.Contains("sections[0].tiles[0]", errors.Keys);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(13)]
    public void ARowCountOutOfRange_IsRejected(int rows)
    {
        Assert.Contains("rows", DashboardValidator.Validate(new DashboardLayout(rows, [])).Keys);
    }
}
