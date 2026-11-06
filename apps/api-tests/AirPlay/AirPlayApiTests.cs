using System.Text.Json;
using HomeyDash.Api.AirPlay;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;

namespace HomeyDash.Api.Tests.AirPlay;

// Against FakeAirPlay and FakePlex: movie 101 and episode 202 play, season 203 does not.
public sealed class AirPlayApiTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private HubConnection? _hub;

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (_hub is not null) await _hub.DisposeAsync();
    }

    private async Task<HubConnection> ConnectAsync(ApiFactory? from = null)
    {
        var f = from ?? factory;
        _hub = new HubConnectionBuilder()
            .WithUrl(new Uri(f.Server.BaseAddress, "api/realtime"), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => f.Server.CreateHandler();
            })
            .Build();
        await _hub.StartAsync();
        return _hub;
    }

    // Plays only what the watcher has seen, which takes a moment after startup.
    private static async Task WaitForLibrariesAsync(HubConnection hub)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!(await hub.InvokeAsync<JsonElement>("Plex")).GetProperty("accounts")[0].GetProperty("loaded").GetBoolean())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("Plex did not load within 5 seconds");
            await Task.Delay(50);
        }
    }

    [Fact]
    public async Task TheDevices_AreThePairedOnesWithTheirKind()
    {
        var info = await (await ConnectAsync()).InvokeAsync<JsonElement>("AirPlayDevices");

        Assert.True(info.GetProperty("available").GetBoolean());
        // The bedroom TV is not paired yet.
        Assert.Equal(["tv", "speaker"], info.GetProperty("devices").EnumerateArray().Select(d => d.GetProperty("kind").GetString()));
    }

    [Fact]
    public async Task AMovie_PlaysOnAReceiverFromTheServerThroughAStreamWithTheToken()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);

        await hub.InvokeAsync("PlayOnAirPlay", 1, "101", FakeAirPlay.LivingRoomTv);

        var url = factory.Services.GetRequiredService<FakeAirPlay>().Playing[FakeAirPlay.LivingRoomTv];
        Assert.Contains("/video/:/transcode/universal/start.m3u8", url);
        Assert.Contains("path=%2Flibrary%2Fmetadata%2F101", url);
        Assert.Contains("X-Plex-Token=fake-token", url);
        await hub.InvokeAsync("StopAirPlay", FakeAirPlay.LivingRoomTv);
        Assert.DoesNotContain(FakeAirPlay.LivingRoomTv, factory.Services.GetRequiredService<FakeAirPlay>().Playing.Keys);
    }

    [Fact]
    public async Task TheTracks_ListTheAudioAndSubtitlesToChooseFrom()
    {
        var hub = await ConnectAsync();

        var tracks = await hub.InvokeAsync<JsonElement>("PlexTracks", 1, "101");

        Assert.Equal(["English (AC3 5.1)", "Nederlands (AAC Stereo)", "Japanese (DTS-HD MA 7.1)"], tracks.GetProperty("audio").EnumerateArray().Select(t => t.GetProperty("label").GetString()));
        Assert.True(tracks.GetProperty("audio")[0].GetProperty("selected").GetBoolean());
        Assert.Equal(3, tracks.GetProperty("subtitles").GetArrayLength());
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("ChangeAirPlayTracks", FakeAirPlay.LivingRoomTv, "2", null));
    }

    [Fact]
    public async Task ASearch_FindsWhatIsNotAmongTheNewest_AndItPlaysToo()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);

        var all = await hub.InvokeAsync<JsonElement[]>("SearchPlex", 1, "dune", null);
        var movies = await hub.InvokeAsync<JsonElement[]>("SearchPlex", 1, "dune", "1");
        var shows = await hub.InvokeAsync<JsonElement[]>("SearchPlex", 1, "dune", "2");

        Assert.Equal(["101", "403"], all.Select(i => i.GetProperty("id").GetString()).Order());
        Assert.Equal(2, movies.Length);
        Assert.Empty(shows);
        Assert.Empty(await hub.InvokeAsync<JsonElement[]>("SearchPlex", 1, "d", null));
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync<JsonElement[]>("SearchPlex", 2, "dune", null));

        // 403 is an old movie, not in the newest list.
        await hub.InvokeAsync("PlayOnAirPlay", 1, "403", FakeAirPlay.LivingRoomTv);
        Assert.Contains("path=%2Flibrary%2Fmetadata%2F403", factory.Services.GetRequiredService<FakeAirPlay>().Playing[FakeAirPlay.LivingRoomTv]);
        // A show has nothing to stream.
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("PlayOnAirPlay", 1, "500", FakeAirPlay.LivingRoomTv));
        await hub.InvokeAsync("StopAirPlay", FakeAirPlay.LivingRoomTv);
    }

    [Fact]
    public async Task WhatPlays_CanBePausedAndResumed_ButNothingElse()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);
        var fake = factory.Services.GetRequiredService<FakeAirPlay>();
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("SetAirPlayPaused", FakeAirPlay.LivingRoomTv, true));
        await hub.InvokeAsync("PlayOnAirPlay", 1, "101", FakeAirPlay.LivingRoomTv);

        await hub.InvokeAsync("SetAirPlayPaused", FakeAirPlay.LivingRoomTv, true);
        Assert.True(fake.Paused.ContainsKey(FakeAirPlay.LivingRoomTv));
        await hub.InvokeAsync("SetAirPlayPaused", FakeAirPlay.LivingRoomTv, false);
        Assert.False(fake.Paused.ContainsKey(FakeAirPlay.LivingRoomTv));
        await hub.InvokeAsync("StopAirPlay", FakeAirPlay.LivingRoomTv);
    }

    [Fact]
    public async Task ASeasonOrAnUnknownItemOrReceiver_IsRefused()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);

        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("PlayOnAirPlay", 1, "203", FakeAirPlay.LivingRoomTv));
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("PlayOnAirPlay", 1, "9999", FakeAirPlay.LivingRoomTv));
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("PlayOnAirPlay", 1, "101", "no-such-receiver"));
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("PlayOnAirPlay", 2, "101", FakeAirPlay.LivingRoomTv));
    }

    [Fact]
    public async Task WithoutTheService_AirPlayIsNotAvailable()
    {
        await using var off = new NoAirPlayApiFactory();
        var hub = await ConnectAsync(off);

        var info = await hub.InvokeAsync<JsonElement>("AirPlayDevices");

        Assert.False(info.GetProperty("available").GetBoolean());
        Assert.Equal(0, info.GetProperty("devices").GetArrayLength());
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("PlayOnAirPlay", 1, "101", FakeAirPlay.LivingRoomTv));
    }
}
