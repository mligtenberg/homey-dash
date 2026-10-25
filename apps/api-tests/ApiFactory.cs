using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace HomeyDash.Api.Tests;

// The API on a throwaway SQLite database, with no Homey address so it runs against FakeHomey.
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"homey-dash-{Guid.NewGuid()}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:HomeyDash", $"Data Source={_dbPath};Pooling=False");
        builder.UseSetting("Homey:Address", "");
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        File.Delete(_dbPath);
    }
}
