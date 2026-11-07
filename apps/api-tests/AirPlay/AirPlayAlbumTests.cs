using System.Text.Json;
using HomeyDash.Api.AirPlay;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;

namespace HomeyDash.Api.Tests.AirPlay;

// An album plays track after track on one receiver, the next starting when the receiver says it finished one. The clock is the
// tests', because only the time since a track started says whether it finished or was stopped on the TV.
public sealed class AirPlayAlbumTests(ClockApiFactory factory) : IClassFixture<ClockApiFactory>, IAsyncLifetime
{
    private HubConnection? _hub;

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (_hub is not null) await _hub.DisposeAsync();
    }

    private async Task<HubConnection> ConnectAsync()
    {
        _hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "api/realtime"), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        await _hub.StartAsync();
        return _hub;
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

    [Fact]
    public async Task AnAlbum_PlaysTrackAfterTrack_FromTheOneChosen_AndEndsAfterTheLast()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);
        var fake = factory.Services.GetRequiredService<FakeAirPlay>();
        var now = factory.Services.GetRequiredService<AirPlayNow>();

        await hub.InvokeAsync("PlayAlbumOnAirPlay", 1, "601", "612", FakeAirPlay.LivingRoomTv);

        Assert.Contains("path=%2Flibrary%2Fmetadata%2F612", fake.Playing[FakeAirPlay.LivingRoomTv]);
        Assert.Equal("Billie Eilish — Happier Than Ever · 2 of 3", now.Find(FakeAirPlay.LivingRoomTv)!.Detail);
        // Played to its end: the next track starts by itself.
        factory.Clock.Advance(TimeSpan.FromMinutes(3));
        fake.EndOnReceiver(FakeAirPlay.LivingRoomTv);
        await Eventually(() => fake.Playing.TryGetValue(FakeAirPlay.LivingRoomTv, out var url) && url.Contains("%2Flibrary%2Fmetadata%2F613"));
        Assert.Equal("Happier Than Ever", now.Find(FakeAirPlay.LivingRoomTv)!.Title);
        // The last track ends the album.
        factory.Clock.Advance(TimeSpan.FromMinutes(5));
        fake.EndOnReceiver(FakeAirPlay.LivingRoomTv);
        await Eventually(() => now.Find(FakeAirPlay.LivingRoomTv) is null);
        Assert.False(fake.Playing.ContainsKey(FakeAirPlay.LivingRoomTv));
    }

    [Fact]
    public async Task ASeason_PlaysEpisodeAfterEpisode_FromTheOneChosen_AndEndsAfterTheLast()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);
        var fake = factory.Services.GetRequiredService<FakeAirPlay>();
        var now = factory.Services.GetRequiredService<AirPlayNow>();

        await hub.InvokeAsync("PlayAlbumOnAirPlay", 1, "510", "520", FakeAirPlay.LivingRoomTv);

        Assert.Contains("path=%2Flibrary%2Fmetadata%2F520", fake.Playing[FakeAirPlay.LivingRoomTv]);
        Assert.Equal("Season 1 · 2 of 3", now.Find(FakeAirPlay.LivingRoomTv)!.Detail);
        // Played to its end: the next episode starts by itself.
        factory.Clock.Advance(TimeSpan.FromMinutes(21));
        fake.EndOnReceiver(FakeAirPlay.LivingRoomTv);
        await Eventually(() => fake.Playing.TryGetValue(FakeAirPlay.LivingRoomTv, out var url) && url.Contains("%2Flibrary%2Fmetadata%2F521"));
        Assert.Equal("Brigade", now.Find(FakeAirPlay.LivingRoomTv)!.Title);
        // The last episode ends the season.
        factory.Clock.Advance(TimeSpan.FromMinutes(27));
        fake.EndOnReceiver(FakeAirPlay.LivingRoomTv);
        await Eventually(() => now.Find(FakeAirPlay.LivingRoomTv) is null);
        Assert.False(fake.Playing.ContainsKey(FakeAirPlay.LivingRoomTv));
    }

    [Fact]
    public async Task AnAlbum_StoppedOnTheTvPartWay_DoesNotGoOn()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);
        var fake = factory.Services.GetRequiredService<FakeAirPlay>();
        var now = factory.Services.GetRequiredService<AirPlayNow>();
        await hub.InvokeAsync("PlayOnAirPlay", 1, "601", FakeAirPlay.LivingRoomTv);
        Assert.Contains("path=%2Flibrary%2Fmetadata%2F611", fake.Playing[FakeAirPlay.LivingRoomTv]);

        factory.Clock.Advance(TimeSpan.FromSeconds(30));
        fake.EndOnReceiver(FakeAirPlay.LivingRoomTv);

        await Eventually(() => now.Find(FakeAirPlay.LivingRoomTv) is null);
        Assert.False(fake.Playing.ContainsKey(FakeAirPlay.LivingRoomTv));
        Assert.Null(now.Queue(FakeAirPlay.LivingRoomTv));
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("PlayAlbumOnAirPlay", 1, "601", "9999", FakeAirPlay.LivingRoomTv));
    }

    private static async Task Eventually(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("It did not happen within 5 seconds");
            await Task.Delay(20);
        }
    }
}
