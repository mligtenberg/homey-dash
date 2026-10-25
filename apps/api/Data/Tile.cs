namespace HomeyDash.Api.Data;

public class Tile
{
    public int Id { get; set; }
    public required string Title { get; set; }
    public string? DeviceId { get; set; }
    public int SortOrder { get; set; }
}
