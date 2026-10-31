using System.Text.Json;
using HomeyDash.Api.Accounts;
using HomeyDash.Api.Homey;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace HomeyDash.Api.Tests.Homey;

public sealed class LocalHomeyTests : IAsyncLifetime
{
    private readonly ScriptedHomeyServer _server = new();
    private readonly HomeyAccounts _accounts = new();
    private readonly Homeys _homeys = new();
    private LocalHomeys _connections = null!;

    private HomeyState _state => _homeys.Find(1)!.State;
    private IHomey _homey => _homeys.Find(1)!.Homey;

    public async Task InitializeAsync()
    {
        await _server.StartAsync();
        LocalHomey.FirstRetryDelay = TimeSpan.FromMilliseconds(50);
        _accounts.Set([Account(1, ScriptedHomeyServer.ApiKey)]);
        _connections = Create(_accounts, _homeys);
        await _connections.StartAsync(CancellationToken.None);
        await Eventually(() => _homeys.Find(1) is not null);
    }

    [Fact]
    public async Task Connecting_LoadsDevicesFlowsAndMoods()
    {
        await Eventually(() => _state.Status.Connection == HomeyConnection.Connected);

        var lamp = _state.FindDevice("lamp")!;
        Assert.Equal("Living room", lamp.ZoneName);
        Assert.True(_state.FindFlow("a1")!.Advanced);
        Assert.Equal("Movie night", _state.FindMood("m1")!.Name);
        Assert.Contains(_state.Zones, z => z is { Id: "zone-living", ParentId: "zone-home" });
        Assert.Contains(_state.FlowFolders, f => f.Id == "ff1");
        Assert.Contains("homey:manager:devices", _server.Subscriptions);
        Assert.Contains("homey:manager:zones", _server.Subscriptions);
        Assert.Contains("homey:device:lamp", _server.Subscriptions);
    }

    [Fact]
    public async Task ACapabilityEvent_UpdatesTheDevice()
    {
        await Eventually(() => _state.Status.Connection == HomeyConnection.Connected);

        await _server.PushAsync("homey:device:lamp", "capability",
            new { capabilityId = "dim", value = 0.9, transactionTime = "2026-10-25T13:00:00.000Z" });

        await Eventually(() => _state.FindDevice("lamp")!.Capabilities["dim"].Value.GetDouble() == 0.9);
    }

    [Fact]
    public async Task ADeviceDeleteEvent_RemovesTheDevice()
    {
        await Eventually(() => _state.Status.Connection == HomeyConnection.Connected);

        await _server.PushAsync("homey:manager:devices", "device.delete", new { id = "lamp" });

        await Eventually(() => _state.FindDevice("lamp") is null);
    }

    [Fact]
    public async Task AZoneEvent_UpdatesTheZones()
    {
        await Eventually(() => _state.Status.Connection == HomeyConnection.Connected);

        await _server.PushAsync("homey:manager:zones", "zone.create", new { id = "zone-kitchen", name = "Kitchen", parent = "zone-home" });

        await Eventually(() => _state.Zones.Any(z => z.Id == "zone-kitchen"));
    }

    [Fact]
    public async Task ALostConnection_ReconnectsAndReloads()
    {
        await Eventually(() => _state.Status.Connection == HomeyConnection.Connected);
        var statuses = new List<HomeyConnection>();
        _state.Changed += c => { if (c is ConnectionChanged changed) lock (statuses) statuses.Add(changed.Status.Connection); };

        _server.DropConnection();

        await Eventually(() => { lock (statuses) return statuses is [.., HomeyConnection.Disconnected, _, HomeyConnection.Connected]; });
        Assert.NotNull(_state.FindDevice("lamp"));
    }

    [Fact]
    public async Task SettingACapability_PutsTheValueToHomey()
    {
        await Eventually(() => _state.Status.Connection == HomeyConnection.Connected);

        await _homey.SetCapabilityValueAsync("lamp", "onoff", JsonSerializer.SerializeToElement(false), CancellationToken.None);
        await _homey.TriggerFlowAsync("a1", CancellationToken.None);

        Assert.Contains(("PUT", "/api/manager/devices/device/lamp/capability/onoff", """{"value":false}"""), _server.Requests);
        Assert.Contains(_server.Requests, r => r is ("POST", "/api/manager/flow/advancedflow/a1/trigger", _));
    }

    [Fact]
    public async Task InsightEntries_AskHomeyForTheLogOfItsOwner()
    {
        var entries = await _homey.GetInsightEntriesAsync("homey:device:abc:measure_power", "last24Hours", CancellationToken.None);

        Assert.Contains(_server.Requests, r => r is ("GET",
            "/api/manager/insights/log/homey:device:abc/homey:device:abc:measure_power/entry?resolution=last24Hours", _));
        Assert.Equal([4.5, 5, null], entries.Select(e => e.V));
    }

    [Fact]
    public async Task AWrongApiKey_KeepsRetryingAndReportsWhy()
    {
        _accounts.Set([Account(1, "wrong-key")]);

        await Eventually(() => _homeys.Find(1)?.State.Status is { Connection: HomeyConnection.Disconnected, LastError: not null });
    }

    [Fact]
    public async Task WithoutAnAccount_ThereIsNoHomey()
    {
        _accounts.Set([]);

        await Eventually(() => _homeys.All.Count == 0);
        Assert.Throws<HomeyUnavailableException>(() => _homeys.Require(null));
    }

    [Fact]
    public async Task ANewAccount_Connects()
    {
        _accounts.Set([]);
        await Eventually(() => _homeys.All.Count == 0);

        _accounts.Set([Account(1, ScriptedHomeyServer.ApiKey)]);

        await Eventually(() => _homeys.Find(1)?.State.Status.Connection == HomeyConnection.Connected);
    }

    [Fact]
    public async Task AReplacedKey_ConnectsAgainWithIt()
    {
        _accounts.Set([Account(1, "wrong-key")]);
        await Eventually(() => _homeys.Find(1)?.State.Status.Connection == HomeyConnection.Disconnected);

        _accounts.Set([Account(1, ScriptedHomeyServer.ApiKey)]);

        await Eventually(() => _homeys.Find(1)?.State.Status.Connection == HomeyConnection.Connected);
    }

    [Fact]
    public async Task ARename_KeepsTheConnection()
    {
        await Eventually(() => _state.Status.Connection == HomeyConnection.Connected);
        var homey = _homey;

        _accounts.Set([Account(1, ScriptedHomeyServer.ApiKey) with { Name = "Upstairs" }]);

        await Eventually(() => _homeys.Find(1)!.Name == "Upstairs");
        Assert.Same(homey, _homey);
        Assert.Equal(HomeyConnection.Connected, _state.Status.Connection);
    }

    [Fact]
    public async Task EveryAccount_HasItsOwnHomey()
    {
        _accounts.Set([Account(1, ScriptedHomeyServer.ApiKey), Account(2, "wrong-key")]);

        await Eventually(() => _homeys.Find(1)?.State.Status.Connection == HomeyConnection.Connected
            && _homeys.Find(2)?.State.Status.Connection == HomeyConnection.Disconnected);
        Assert.Equal(1, _homeys.For(null)!.AccountId);
        Assert.Equal(2, _homeys.Find(2)!.State.Status.AccountId);
    }

    [Fact]
    public async Task ARemovedAccount_LetsGoOfItsHomey()
    {
        _accounts.Set([Account(1, ScriptedHomeyServer.ApiKey), Account(2, ScriptedHomeyServer.ApiKey)]);
        await Eventually(() => _homeys.All.Count == 2);

        _accounts.Set([Account(2, ScriptedHomeyServer.ApiKey)]);

        await Eventually(() => _homeys.All is [{ AccountId: 2 }]);
        Assert.Throws<HomeyNotFoundException>(() => _homeys.Require(1));
        Assert.Equal(2, _homeys.For(null)!.AccountId);
    }

    private HomeyAccount Account(int id, string apiKey) =>
        new(_server.Address.ToString(), apiKey) { Id = id, Name = $"Homey {id}" };

    private static LocalHomeys Create(HomeyAccounts accounts, Homeys homeys)
    {
        var services = new ServiceCollection();
        services.AddHttpClient(LocalHomey.HttpClientName);
        var factory = services.BuildServiceProvider().GetRequiredService<IHttpClientFactory>();
        return new LocalHomeys(factory, accounts, homeys, TimeProvider.System, NullLoggerFactory.Instance);
    }

    private static async Task Eventually(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("Condition not met within 5 seconds");
            await Task.Delay(20);
        }
    }

    public async Task DisposeAsync()
    {
        await _connections.StopAsync(CancellationToken.None);
        _connections.Dispose();
        await _server.DisposeAsync();
    }
}
