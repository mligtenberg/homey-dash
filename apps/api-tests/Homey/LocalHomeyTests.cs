using System.Text.Json;
using HomeyDash.Api.Accounts;
using HomeyDash.Api.Homey;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace HomeyDash.Api.Tests.Homey;

public sealed class LocalHomeyTests : IAsyncLifetime
{
    private readonly ScriptedHomeyServer _server = new();
    private readonly HomeyState _state = new(TimeProvider.System);
    private readonly CurrentHomeyAccount _account = new();
    private LocalHomey _homey = null!;

    public async Task InitializeAsync()
    {
        await _server.StartAsync();
        LocalHomey.FirstRetryDelay = TimeSpan.FromMilliseconds(50);
        _account.Set(new HomeyAccount(_server.Address.ToString(), ScriptedHomeyServer.ApiKey));
        _homey = Create(_account);
        await _homey.StartAsync(CancellationToken.None);
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
        await _homey.StopAsync(CancellationToken.None);
        var state = new HomeyState(TimeProvider.System);
        var homey = Create("wrong-key", state);
        await homey.StartAsync(CancellationToken.None);

        await Eventually(() => state.Status is { Connection: HomeyConnection.Disconnected, LastError: not null });
        await homey.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task WithoutAnAccount_WaitsUntilOneIsSetUp()
    {
        await _homey.StopAsync(CancellationToken.None);
        var state = new HomeyState(TimeProvider.System);
        var account = new CurrentHomeyAccount();
        var homey = Create(account, state);
        await homey.StartAsync(CancellationToken.None);

        await Eventually(() => state.Status.Connection == HomeyConnection.NotSetUp);
        account.Set(new HomeyAccount(_server.Address.ToString(), ScriptedHomeyServer.ApiKey));

        await Eventually(() => state.Status.Connection == HomeyConnection.Connected);
        await homey.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task AReplacedAccount_ConnectsAgainWithIt()
    {
        await _homey.StopAsync(CancellationToken.None);
        var state = new HomeyState(TimeProvider.System);
        var account = new CurrentHomeyAccount();
        account.Set(new HomeyAccount(_server.Address.ToString(), "wrong-key"));
        var homey = Create(account, state);
        await homey.StartAsync(CancellationToken.None);
        await Eventually(() => state.Status.Connection == HomeyConnection.Disconnected);

        account.Set(new HomeyAccount(_server.Address.ToString(), ScriptedHomeyServer.ApiKey));

        await Eventually(() => state.Status.Connection == HomeyConnection.Connected);
        await homey.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task ARemovedAccount_IsNotSetUp()
    {
        await Eventually(() => _state.Status.Connection == HomeyConnection.Connected);

        _account.Set(null);

        await Eventually(() => _state.Status.Connection == HomeyConnection.NotSetUp);
        await Assert.ThrowsAsync<HomeyUnavailableException>(() => _homey.TriggerFlowAsync("f1", CancellationToken.None));
    }

    private LocalHomey Create(string apiKey, HomeyState? state = null)
    {
        var account = new CurrentHomeyAccount();
        account.Set(new HomeyAccount(_server.Address.ToString(), apiKey));
        return Create(account, state);
    }

    private LocalHomey Create(CurrentHomeyAccount account, HomeyState? state = null)
    {
        var services = new ServiceCollection();
        services.AddHttpClient(LocalHomey.HttpClientName);
        var factory = services.BuildServiceProvider().GetRequiredService<IHttpClientFactory>();
        return new LocalHomey(factory, account, state ?? _state, NullLogger<LocalHomey>.Instance);
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
        await _homey.StopAsync(CancellationToken.None);
        _homey.Dispose();
        await _server.DisposeAsync();
    }
}
