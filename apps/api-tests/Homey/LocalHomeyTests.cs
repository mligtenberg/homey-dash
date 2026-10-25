using System.Text.Json;
using HomeyDash.Api.Homey;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace HomeyDash.Api.Tests.Homey;

public sealed class LocalHomeyTests : IAsyncLifetime
{
    private readonly ScriptedHomeyServer _server = new();
    private readonly HomeyState _state = new(TimeProvider.System);
    private LocalHomey _homey = null!;

    public async Task InitializeAsync()
    {
        await _server.StartAsync();
        LocalHomey.FirstRetryDelay = TimeSpan.FromMilliseconds(50);
        _homey = Create(ScriptedHomeyServer.ApiKey);
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
        Assert.Contains("homey:manager:devices", _server.Subscriptions);
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
    public async Task AWrongApiKey_KeepsRetryingAndReportsWhy()
    {
        await _homey.StopAsync(CancellationToken.None);
        var state = new HomeyState(TimeProvider.System);
        var homey = Create("wrong-key", state);
        await homey.StartAsync(CancellationToken.None);

        await Eventually(() => state.Status is { Connection: HomeyConnection.Disconnected, LastError: not null });
        await homey.StopAsync(CancellationToken.None);
    }

    private LocalHomey Create(string apiKey, HomeyState? state = null)
    {
        var options = new HomeyOptions { Address = _server.Address.ToString(), ApiKey = apiKey };
        var services = new ServiceCollection();
        services.AddHttpClient(LocalHomey.HttpClientName, http => LocalHomey.ConfigureHttpClient(http, options));
        var factory = services.BuildServiceProvider().GetRequiredService<IHttpClientFactory>();
        return new LocalHomey(factory, Options.Create(options), state ?? _state, NullLogger<LocalHomey>.Instance);
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
