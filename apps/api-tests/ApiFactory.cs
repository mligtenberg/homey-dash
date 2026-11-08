using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace HomeyDash.Api.Tests;

// The API on a throwaway SQLite database, running against FakeHomey.
public class ApiFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"homey-dash-{Guid.NewGuid()}.db");

    protected virtual bool FakeHomey => true;

    protected virtual bool FakeImmich => true;

    protected virtual bool FakePlex => true;

    protected virtual bool FakeAirPlay => true;

    protected virtual bool FakeTraffic => true;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:HomeyDash", $"Data Source={_dbPath};Pooling=False");
        builder.UseSetting("Homey:Fake", FakeHomey ? "true" : "false");
        builder.UseSetting("Immich:Fake", FakeImmich ? "true" : "false");
        builder.UseSetting("Plex:Fake", FakePlex ? "true" : "false");
        builder.UseSetting("AirPlay:Fake", FakeAirPlay ? "true" : "false");
        // Tests never ask Open-Meteo or Buienradar.
        builder.UseSetting("Weather:Fake", "true");
        // Nor TomTom.
        builder.UseSetting("Traffic:Fake", FakeTraffic ? "true" : "false");
        // Without the fake, AirPlay is off: tests don't look for receivers on the network.
        builder.UseSetting("AirPlay:Enabled", FakeAirPlay ? "true" : "false");
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        File.Delete(_dbPath);
    }
}

// The API with a real Homey connection, which waits for a Homey account to be set up in Management.
public sealed class RealHomeyApiFactory : ApiFactory
{
    protected override bool FakeHomey => false;
}

// The API with the real Immich client, which waits for an Immich account to be set up in Management.
public sealed class RealImmichApiFactory : ApiFactory
{
    protected override bool FakeImmich => false;
}

// The API with the real Plex client, which waits for someone to sign in with Plex in Management.
public sealed class RealPlexApiFactory : ApiFactory
{
    protected override bool FakePlex => false;
}

// The API with a clock the tests move on, starting Monday 2 November 2026 at 10:00 in Amsterdam.
public sealed class ClockApiFactory : ApiFactory
{
    public FakeTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 11, 2, 9, 0, 0, TimeSpan.Zero));

    public ClockApiFactory() => Clock.SetLocalTimeZone(TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(Clock));
    }
}

// The API with AirPlay switched off.
public sealed class NoAirPlayApiFactory : ApiFactory
{
    protected override bool FakeAirPlay => false;
}
