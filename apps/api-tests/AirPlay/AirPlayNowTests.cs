using System.Text.Json;
using HomeyDash.Api.AirPlay;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;

namespace HomeyDash.Api.Tests.AirPlay;

// What plays on an Apple TV is one thing for every screen: started on one, it shows and answers on all.
public sealed class AirPlayNowTests(ClockApiFactory factory) : IClassFixture<ClockApiFactory>, IAsyncLifetime
{
    private readonly List<HubConnection> _hubs = [];

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var hub in _hubs) await hub.DisposeAsync();
    }

    private async Task<HubConnection> ConnectAsync()
    {
        var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "api/realtime"), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        _hubs.Add(hub);
        await hub.StartAsync();
        return hub;
    }

    private static async Task WaitForLibrariesAsync(HubConnection hub)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!(await hub.InvokeAsync<JsonElement>("Plex")).GetProperty("accounts")[0].GetProperty("loaded").GetBoolean())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("Plex did not load within 5 seconds");
            await Task.Delay(50);
        }
    }

    // The next AirPlayNow message a connection receives.
    private static Task<JsonElement[]> NextAsync(HubConnection hub)
    {
        var next = new TaskCompletionSource<JsonElement[]>();
        hub.On<JsonElement[]>("AirPlayNow", playing => next.TrySetResult(playing));
        return next.Task.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task APlayback_StartedOnOneScreen_ShowsOnTheOthers_AndAnyOfThemCanPauseAndStopIt()
    {
        var starter = await ConnectAsync();
        var other = await ConnectAsync();
        await WaitForLibrariesAsync(starter);
        Assert.Empty(await other.InvokeAsync<JsonElement[]>("AirPlayNowPlaying"));

        var started = NextAsync(other);
        await starter.InvokeAsync("PlayOnAirPlay", 1, "101", FakeAirPlay.LivingRoomTv);
        var playing = Assert.Single(await started);
        Assert.Equal("Dune: Part Two", playing.GetProperty("title").GetString());
        Assert.Equal("Living room TV", playing.GetProperty("deviceName").GetString());
        Assert.False(playing.GetProperty("paused").GetBoolean());
        // A screen that joins later is told too.
        Assert.Single(await (await ConnectAsync()).InvokeAsync<JsonElement[]>("AirPlayNowPlaying"));

        var paused = NextAsync(starter);
        await other.InvokeAsync("SetAirPlayPaused", FakeAirPlay.LivingRoomTv, true);
        Assert.True(Assert.Single(await paused).GetProperty("paused").GetBoolean());

        var stopped = NextAsync(starter);
        await other.InvokeAsync("StopAirPlay", FakeAirPlay.LivingRoomTv);
        Assert.Empty(await stopped);
    }

    [Fact]
    public async Task AVideoOrLivestreamOfNos_PlaysOnTheTv_AndShowsLikeAnyPlayback()
    {
        var hub = await ConnectAsync();
        var other = await ConnectAsync();
        var fake = factory.Services.GetRequiredService<FakeAirPlay>();

        var started = NextAsync(other);
        await hub.InvokeAsync("PlayNewsOnAirPlay", "video", "1", FakeAirPlay.LivingRoomTv);
        var playing = Assert.Single(await started);
        Assert.Equal("nos", playing.GetProperty("source").GetString());
        Assert.Equal("Dierentuin voorbereid op noodsituatie", playing.GetProperty("title").GetString());
        Assert.Equal(110_000, playing.GetProperty("durationMs").GetInt64());
        Assert.StartsWith("https://", fake.Playing[FakeAirPlay.LivingRoomTv]);

        // The same controls as for Plex; a livestream that is on replaces it; one that has not started cannot be played.
        await other.InvokeAsync("SetAirPlayPaused", FakeAirPlay.LivingRoomTv, true);
        await hub.InvokeAsync("PlayNewsOnAirPlay", "live", "l1", FakeAirPlay.LivingRoomTv);
        Assert.Equal("Tweede Kamer debatteert over het Belastingplan", Assert.Single(await hub.InvokeAsync<JsonElement[]>("AirPlayNowPlaying")).GetProperty("title").GetString());
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("PlayNewsOnAirPlay", "live", "l2", FakeAirPlay.LivingRoomTv));
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("PlayNewsOnAirPlay", "video", "nope", FakeAirPlay.LivingRoomTv));

        var stopped = NextAsync(other);
        await hub.InvokeAsync("StopAirPlay", FakeAirPlay.LivingRoomTv);
        Assert.Empty(await stopped);
    }

    [Fact]
    public async Task APlaybackEndedOnTheTv_EndsForEveryScreen()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);
        await hub.InvokeAsync("PlayOnAirPlay", 1, "101", FakeAirPlay.LivingRoomTv);

        var ended = NextAsync(hub);
        factory.Services.GetRequiredService<FakeAirPlay>().EndOnReceiver(FakeAirPlay.LivingRoomTv);

        Assert.Empty(await ended);
    }

    [Fact]
    public async Task ChangingATrack_StartsTheStreamOverFromWhereItWasByTheServersCount_PausedTimeNotCounted()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);
        var fake = factory.Services.GetRequiredService<FakeAirPlay>();
        await hub.InvokeAsync("PlayOnAirPlay", 1, "101", FakeAirPlay.LivingRoomTv);

        factory.Clock.Advance(TimeSpan.FromSeconds(600));
        await hub.InvokeAsync("SetAirPlayPaused", FakeAirPlay.LivingRoomTv, true);
        factory.Clock.Advance(TimeSpan.FromSeconds(300));
        await hub.InvokeAsync("SetAirPlayPaused", FakeAirPlay.LivingRoomTv, false);
        factory.Clock.Advance(TimeSpan.FromSeconds(154));
        var changed = NextAsync(hub);
        await hub.InvokeAsync("ChangeAirPlayTracks", FakeAirPlay.LivingRoomTv, "2", "12");

        var url = fake.Playing[FakeAirPlay.LivingRoomTv];
        Assert.Contains("audioStreamID=2", url);
        Assert.Contains("subtitleStreamID=12", url);
        Assert.Contains("subtitles=burn", url);
        Assert.Contains("offset=754", url);
        var playing = Assert.Single(await changed);
        Assert.Equal("2", playing.GetProperty("audioStreamId").GetString());
        Assert.Equal("12", playing.GetProperty("subtitleStreamId").GetString());

        // Back to no subtitle, and the position goes on from there.
        factory.Clock.Advance(TimeSpan.FromSeconds(6));
        await hub.InvokeAsync("ChangeAirPlayTracks", FakeAirPlay.LivingRoomTv, "1", null);
        Assert.Contains("offset=760", fake.Playing[FakeAirPlay.LivingRoomTv]);
        Assert.Contains("subtitles=none", fake.Playing[FakeAirPlay.LivingRoomTv]);
        await hub.InvokeAsync("StopAirPlay", FakeAirPlay.LivingRoomTv);
    }
}
