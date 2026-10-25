using System.Net;
using System.Net.Http.Json;
using HomeyDash.Api.Data;
using Microsoft.AspNetCore.Mvc.Testing;

namespace HomeyDash.Api.Tests;

public class TilesApiTests : IDisposable
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"homey-dash-{Guid.NewGuid()}.db");
    private readonly WebApplicationFactory<Program> _factory;

    public TilesApiTests()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("ConnectionStrings:HomeyDash", $"Data Source={_dbPath};Pooling=False"));
    }

    [Fact]
    public async Task Health_ReturnsOk()
    {
        var response = await _factory.CreateClient().GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task CreatedTile_IsPersistedAndListed()
    {
        var client = _factory.CreateClient();

        var created = await client.PostAsJsonAsync("/api/tiles", new { title = "Living room lamp", deviceId = "abc" });
        var tiles = await client.GetFromJsonAsync<List<Tile>>("/api/tiles");

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Contains(tiles!, t => t.Title == "Living room lamp" && t.DeviceId == "abc");
    }

    public void Dispose()
    {
        _factory.Dispose();
        File.Delete(_dbPath);
    }
}
