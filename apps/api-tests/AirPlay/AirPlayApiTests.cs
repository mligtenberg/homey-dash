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
    public async Task ASearch_FindsSeriesAndAlbumsByName_AndEpisodesAndTracksOnlyByTheirOwn()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);

        async Task<string[]> Ids(string query, string? library = null) =>
            (await hub.InvokeAsync<JsonElement[]>("SearchPlex", 1, query, library)).Select(i => i.GetProperty("id").GetString()!).Order().ToArray();

        // The show and the episode named after it, not the episodes of the show; seasons are reached through the show.
        Assert.Equal(["500"], await Ids("bear", "2"));
        Assert.Equal(["501"], await Ids("system", "2"));
        // The album, and the track that shares its name, not the other tracks of the album.
        Assert.Equal(["601", "613"], await Ids("happier", "3"));
        Assert.Equal(["312"], await Ids("lunch"));
        Assert.Empty(await Ids("skinny", "1"));
    }

    [Fact]
    public async Task ALibrary_ListsOnlyItsFilmsSeriesOrAlbums_AlphabeticallyInPages()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);

        async Task<(string[] Titles, int Total)> Page(string library, int start, int size)
        {
            var page = await hub.InvokeAsync<JsonElement>("PlexLibraryItems", 1, library, start, size);
            return (page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()!).ToArray(), page.GetProperty("total").GetInt32());
        }

        // Films, series and albums only: no episodes, seasons or tracks.
        var (films, filmTotal) = await Page("1", 0, 100);
        Assert.Equal(["Anora", "Arrival", "Blade Runner 2049", "Dune", "Dune: Part Two", "Oppenheimer", "Past Lives", "Perfect Days"], films);
        Assert.Equal(8, filmTotal);
        Assert.Equal(["Andor", "Severance", "Slow Horses", "The Bear"], (await Page("2", 0, 100)).Titles);
        Assert.Equal(["Brat", "Happier Than Ever", "Hit Me Hard and Soft", "Short n' Sweet"], (await Page("3", 0, 100)).Titles);
        // A page at a time.
        var second = await Page("1", 2, 3);
        Assert.Equal(["Blade Runner 2049", "Dune", "Dune: Part Two"], second.Titles);
        Assert.Equal(8, second.Total);
        Assert.Empty((await Page("1", 50, 10)).Titles);
        // The library has a count on the overview.
        var overview = await hub.InvokeAsync<JsonElement>("Plex");
        Assert.Equal([8, 4, 4], overview.GetProperty("accounts")[0].GetProperty("libraries").EnumerateArray().Select(l => l.GetProperty("count").GetInt32()));
        // What a library shows of its newest is films, series or albums, never an episode or a track.
        var titles = overview.GetProperty("accounts")[0].GetProperty("libraries")[1].GetProperty("titles").EnumerateArray().Select(i => i.GetProperty("kind").GetString());
        Assert.NotEmpty(titles);
        Assert.All(titles, kind => Assert.Equal("show", kind));
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync<JsonElement>("PlexLibraryItems", 1, "99", 0, 10));
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync<JsonElement>("PlexLibraryItems", 2, "1", 0, 10));
    }

    [Fact]
    public async Task WhatWasPlayed_IsSaidOfFilmsEpisodesAndSeasons()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);

        async Task<(string, bool)[]> Watched(string method, params object[] args) =>
            (await hub.InvokeCoreAsync<JsonElement[]>(method, args)).Select(i => (i.GetProperty("title").GetString()!, i.GetProperty("watched").GetBoolean())).ToArray();

        var films = (await hub.InvokeAsync<JsonElement>("PlexLibraryItems", 1, "1", 0, 100)).GetProperty("items").EnumerateArray()
            .Where(i => i.GetProperty("watched").GetBoolean()).Select(i => i.GetProperty("title").GetString());
        Assert.Equal(["Arrival", "Past Lives"], films);
        Assert.Equal([("Season 1", false), ("Season 2", true)], await Watched("PlexChildren", 1, "500"));
        Assert.Equal([("System", true), ("Hands", true), ("Brigade", false)], await Watched("PlexChildren", 1, "510"));
    }

    [Fact]
    public async Task WhatIsUnderAnItem_IsListedInOrder()
    {
        var hub = await ConnectAsync();

        async Task<string[]> Titles(string id) =>
            (await hub.InvokeAsync<JsonElement[]>("PlexChildren", 1, id)).Select(i => i.GetProperty("title").GetString()!).ToArray();

        Assert.Equal(["Season 1", "Season 2"], await Titles("500"));
        Assert.Equal(["System", "Hands", "Brigade"], await Titles("510"));
        Assert.Equal(["Getting Older", "I Didn't Change My Number", "Happier Than Ever"], await Titles("601"));
        // A recently added season is a season of its show: its episodes are under it.
        Assert.Equal(["Anjin", "Servants of Two Masters"], await Titles("203"));
        Assert.Empty(await Titles("101"));
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync<JsonElement[]>("PlexChildren", 2, "500"));
    }

    [Fact]
    public async Task ATrack_PlaysByItself_AsAudio()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);

        await hub.InvokeAsync("PlayOnAirPlay", 1, "612", FakeAirPlay.LivingRoomTv);

        var url = factory.Services.GetRequiredService<FakeAirPlay>().Playing[FakeAirPlay.LivingRoomTv];
        Assert.Contains("/audio/:/transcode/universal/start.mp3", url);
        Assert.Contains("path=%2Flibrary%2Fmetadata%2F612", url);
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
    public async Task AShowOrAnUnknownItemOrReceiver_IsRefused()
    {
        var hub = await ConnectAsync();
        await WaitForLibrariesAsync(hub);

        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("PlayOnAirPlay", 1, "500", FakeAirPlay.LivingRoomTv));
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
