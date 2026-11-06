using System.Net;
using System.Text;
using System.Text.Json;
using HomeyDash.Api.Plex;

namespace HomeyDash.Api.Tests.Plex;

// PlexClient against a scripted plex.tv and Plex server.
public class PlexClientTests
{
    private static readonly PlexConnection Server = new("http://192.168.1.30:32400", "server-token", "client-1");

    private sealed class ScriptedPlex(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler, IHttpClientFactory
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        public HttpClient CreateClient(string name) => new(this, disposeHandler: false);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request);
            return Task.FromResult(answer(request));
        }
    }

    private static HttpResponseMessage Json(object value, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json") };

    private static PlexClient Client(ScriptedPlex plex) => new(plex, TimeProvider.System);

    [Fact]
    public async Task APin_LinksToPlexsOwnPage()
    {
        var plex = new ScriptedPlex(_ => Json(new { id = 42, code = "abcd" }));

        var pin = await Client(plex).CreatePinAsync("client-1", CancellationToken.None);

        Assert.Equal(42, pin.Id);
        Assert.StartsWith("https://app.plex.tv/auth#?clientID=client-1&code=abcd", pin.AuthUrl.ToString());
        Assert.Equal("client-1", plex.Requests[0].Headers.GetValues("X-Plex-Client-Identifier").Single());
        Assert.Equal("HomeyDash", plex.Requests[0].Headers.GetValues("X-Plex-Product").Single());
    }

    [Fact]
    public async Task APin_HasATokenOnlyOnceApproved()
    {
        var approved = false;
        var plex = new ScriptedPlex(_ => Json(new { id = 42, code = "abcd", authToken = approved ? "token" : null }));
        var client = Client(plex);

        var before = await client.CheckPinAsync("client-1", 42, CancellationToken.None);
        approved = true;
        var after = await client.CheckPinAsync("client-1", 42, CancellationToken.None);

        Assert.Null(before);
        Assert.Equal("token", after);
    }

    [Fact]
    public async Task Servers_AreOnlyResourcesThatServe()
    {
        var plex = new ScriptedPlex(_ => Json(new object[]
        {
            new { name = "Attic", clientIdentifier = "s1", provides = "server", owned = true, accessToken = "t1",
                connections = new[] { new { uri = "http://192.168.1.30:32400", local = true, relay = false } } },
            new { name = "iPhone", clientIdentifier = "p1", provides = "client,player", owned = true, accessToken = "t2", connections = Array.Empty<object>() },
        }));

        var servers = await Client(plex).ServersAsync("client-1", "token", CancellationToken.None);

        var server = Assert.Single(servers);
        Assert.Equal("Attic", server.Name);
        Assert.True(server.Addresses[0].Local);
    }

    [Fact]
    public async Task Connecting_TriesLocalAddressesFirst_AndSkipsThoseThatDoNotAnswer()
    {
        var plex = new ScriptedPlex(request => request.RequestUri!.Host == "192.168.1.30"
            ? throw new HttpRequestException("No route")
            : Json(new { MediaContainer = new { machineIdentifier = "s1" } }));
        var server = new PlexServerChoice("s1", "Attic", true, "t1",
        [
            new PlexServerAddress("https://relay.plex.direct:8443", false, true),
            new PlexServerAddress("https://remote.plex.direct:32400", false, false),
            new PlexServerAddress("http://192.168.1.30:32400", true, false),
        ]);

        var uri = await Client(plex).ConnectAsync("client-1", server, CancellationToken.None);

        Assert.Equal("https://remote.plex.direct:32400", uri);
        Assert.Equal("192.168.1.30", plex.Requests[0].RequestUri!.Host);
    }

    [Fact]
    public async Task Sessions_SayWhatPlaysWhereAndHowFar()
    {
        var plex = new ScriptedPlex(_ => Json(new
        {
            MediaContainer = new
            {
                Metadata = new object[]
                {
                    new
                    {
                        sessionKey = "7", type = "episode", title = "Next", grandparentTitle = "The Bear", parentIndex = 3, index = 2,
                        grandparentThumb = "/library/metadata/200/thumb/1", thumb = "/library/metadata/202/thumb/1", duration = 1920000,
                        viewOffset = 600000, User = new { title = "Sam" },
                        Player = new { title = "iPad", product = "Plex for iOS", state = "paused", machineIdentifier = "ipad-1" },
                    },
                },
            },
        }));

        var session = Assert.Single(await Client(plex).SessionsAsync(Server, CancellationToken.None));

        Assert.Equal(("episode", "Next", "The Bear · S3 E2"), (session.Kind, session.Title, session.Subtitle));
        Assert.Equal("/library/metadata/200/thumb/1", session.Image);
        Assert.Equal((600000L, 1920000L, "paused"), (session.OffsetMs, session.DurationMs, session.State));
        Assert.Equal(("Sam", "ipad-1", "iPad"), (session.User, session.PlayerId, session.PlayerName));
        Assert.Equal("server-token", plex.Requests[0].Headers.GetValues("X-Plex-Token").Single());
    }

    [Fact]
    public async Task Controlling_GoesThroughTheServerToThePlayer()
    {
        var plex = new ScriptedPlex(_ => new HttpResponseMessage(HttpStatusCode.OK));

        await Client(plex).ControlAsync(Server, "ipad-1", PlexCommand.Pause, "episode", CancellationToken.None);

        var request = Assert.Single(plex.Requests);
        Assert.StartsWith("http://192.168.1.30:32400/player/playback/pause?type=video&commandID=", request.RequestUri!.ToString());
        Assert.Equal("ipad-1", request.Headers.GetValues("X-Plex-Target-Client-Identifier").Single());
    }

    [Fact]
    public async Task APlayerThatTakesNoRemoteControl_SaysSo()
    {
        var plex = new ScriptedPlex(_ => new HttpResponseMessage(HttpStatusCode.NotFound));

        var e = await Assert.ThrowsAsync<PlexException>(() =>
            Client(plex).ControlAsync(Server, "tv-1", PlexCommand.SkipNext, "movie", CancellationToken.None));

        Assert.Contains("Advertise as player", e.Message);
    }

    [Fact]
    public async Task RecentlyAdded_ShowsAShowsPosterForItsSeason()
    {
        var plex = new ScriptedPlex(request => request.RequestUri!.AbsolutePath == "/library/sections"
            ? Json(new { MediaContainer = new { Directory = new object[]
                {
                    new { key = "2", title = "TV Shows", type = "show" },
                    new { key = "9", title = "Home videos", type = "photo" },
                } } })
            : Json(new { MediaContainer = new { Metadata = new object[]
                {
                    new { ratingKey = "300", type = "season", title = "Season 1", parentTitle = "Shōgun", parentThumb = "/library/metadata/299/thumb/1", addedAt = 1_790_000_000 },
                } } }));

        var library = Assert.Single(await Client(plex).LibrariesAsync(Server, 24, CancellationToken.None));

        var item = Assert.Single(library.Recent);
        Assert.Equal(("Shōgun", "Season 1", "/library/metadata/299/thumb/1"), (item.Title, item.Subtitle, item.Image));
    }

    [Fact]
    public async Task RecentlyAdded_CarriesWhatTheDetailViewShows()
    {
        var plex = new ScriptedPlex(request => request.RequestUri!.AbsolutePath == "/library/sections"
            ? Json(new { MediaContainer = new { Directory = new object[] { new { key = "1", title = "Movies", type = "movie" } } } })
            : Json(new { MediaContainer = new { Metadata = new object[]
                {
                    new
                    {
                        ratingKey = "100", type = "movie", title = "Dune: Part Two", year = 2024, duration = 9_960_000, summary = "  Paul unites with the Fremen.  ",
                        audienceRating = 8.44, rating = 9.0, contentRating = "PG-13", art = "/library/metadata/100/art/1", addedAt = 1_790_000_000,
                        Genre = new object[] { new { tag = "Science Fiction" }, new { tag = "Adventure" }, new { tag = "Drama" }, new { tag = "Action" } },
                    },
                    new { ratingKey = "101", type = "movie", title = "Bare", addedAt = 1_790_000_000 },
                } } }));

        var library = Assert.Single(await Client(plex).LibrariesAsync(Server, 24, CancellationToken.None));

        var dune = library.Recent[0];
        Assert.Equal(("Paul unites with the Fremen.", 2024, 9_960_000L, 8.4, "PG-13", "/library/metadata/100/art/1"),
            (dune.Summary, dune.Year, dune.DurationMs, dune.Rating, dune.ContentRating, dune.Art));
        Assert.Equal(["Science Fiction", "Adventure", "Drama"], dune.Genres);
        var bare = library.Recent[1];
        Assert.Equal((null, null, null, null, 0), (bare.Summary, bare.Year, bare.Rating, bare.ContentRating, bare.Genres.Count));
    }

    [Fact]
    public async Task Search_AsksTheServerForTheWholeLibrary_AndKeepsWhatACardCanShow()
    {
        var plex = new ScriptedPlex(_ => Json(new { MediaContainer = new { Hub = new object[]
        {
            new { type = "movie", Metadata = new object[] { new { ratingKey = "7", type = "movie", title = "Arrival", year = 2016, addedAt = 1_600_000_000 } } },
            new { type = "show", Metadata = new object[] { new { ratingKey = "8", type = "show", title = "Arrival Show", year = 2020, addedAt = 1_600_000_000 } } },
            new { type = "season", Metadata = new object[] { new { ratingKey = "10", type = "season", title = "Season 1", parentTitle = "Arrival Show", addedAt = 1_600_000_000 } } },
            new { type = "actor" },
            new { type = "track", Metadata = new object[] { new { ratingKey = "9", type = "track", title = "Arrival", addedAt = 1_600_000_000 } } },
            new { type = "movie", Metadata = new object[] { new { ratingKey = "7", type = "movie", title = "Arrival", addedAt = 1_600_000_000 } } },
        } } }));

        var found = await Client(plex).SearchAsync(Server, "arri val", "1", 12, CancellationToken.None);

        Assert.Equal(["7", "8", "9"], found.Select(i => i.Id));
        Assert.Equal(["movie", "show", "track"], found.Select(i => i.Kind));
        var request = plex.Requests.Single().RequestUri!;
        Assert.Equal("/hubs/search", request.AbsolutePath);
        Assert.Contains("query=arri%20val", request.Query);
        Assert.Contains("sectionId=1", request.Query);
    }

    [Fact]
    public async Task Search_FindsAnEpisodeOrATrackByItsOwnTitle_NotByItsShowOrAlbum()
    {
        var plex = new ScriptedPlex(_ => Json(new { MediaContainer = new { Hub = new object[]
        {
            new { type = "episode", Metadata = new object[]
            {
                new { ratingKey = "1", type = "episode", title = "Bear Hug", grandparentTitle = "Show", addedAt = 1 },
                new { ratingKey = "2", type = "episode", title = "System", grandparentTitle = "The Bear", addedAt = 1 },
            } },
            new { type = "album", Metadata = new object[] { new { ratingKey = "3", type = "album", title = "Bear Songs", parentTitle = "Band", addedAt = 1 } } },
            new { type = "track", Metadata = new object[]
            {
                new { ratingKey = "4", type = "track", title = "Hungry Bear", parentTitle = "Album", addedAt = 1 },
                new { ratingKey = "5", type = "track", title = "Lunch", parentTitle = "Bear Songs", grandparentTitle = "Band", addedAt = 1 },
            } },
        } } }));

        var found = await Client(plex).SearchAsync(Server, "Bear", null, 12, CancellationToken.None);

        Assert.Equal(["1", "3", "4"], found.Select(i => i.Id));
    }

    [Fact]
    public async Task Children_AreTheSeasonsOfAShow_TheEpisodesOfASeason_AndTheTracksOfAnAlbum()
    {
        var plex = new ScriptedPlex(request => request.RequestUri!.AbsolutePath.Contains("/10/") ? Json(new { MediaContainer = new { Metadata = new object[]
        {
            new { ratingKey = "11", type = "season", title = "Season 1", parentTitle = "Show", index = 1, leafCount = 8, thumb = "/library/metadata/11/thumb/1", parentThumb = "/library/metadata/10/thumb/1" },
            new { ratingKey = "12", type = "season", title = "Specials", parentTitle = "Show", index = 0, leafCount = 1 },
        } } }) : Json(new { MediaContainer = new { Metadata = new object[]
        {
            new { ratingKey = "21", type = "track", title = "First", index = 1, duration = 180_000, originalTitle = "Guest", parentThumb = "/library/metadata/20/thumb/1" },
            new { ratingKey = "22", type = "track", title = "Second", index = 2, duration = 200_000 },
        } } }));

        var seasons = await Client(plex).ChildrenAsync(Server, "10", CancellationToken.None);
        var tracks = await Client(plex).ChildrenAsync(Server, "20", CancellationToken.None);

        Assert.Equal([("Season 1", "8 episodes", 1, "/library/metadata/11/thumb/1"), ("Specials", "1 episode", null, null)],
            seasons.Select(s => (s.Title, s.Subtitle, s.Index, s.Image)));
        Assert.Equal([("First", "Guest", 1, 180_000L), ("Second", null, 2, 200_000L)], tracks.Select(t => (t.Title, t.Subtitle, t.Index, t.DurationMs)));
        Assert.Equal("/library/metadata/20/thumb/1", tracks[0].Image);
        Assert.Equal("/library/metadata/10/children", plex.Requests[0].RequestUri!.AbsolutePath);
    }

    [Fact]
    public async Task ALibraryPage_IsTheTopOfTheLibrary_SortedByTitle_AndAnArtistLibraryListsItsAlbums()
    {
        var plex = new ScriptedPlex(_ => Json(new { MediaContainer = new { totalSize = 120, Metadata = new object[]
            { new { ratingKey = "1", type = "album", title = "Brat", parentTitle = "Charli xcx", addedAt = 1 } } } }));

        var page = await Client(plex).LibraryItemsAsync(Server, "3", "artist", 60, 30, CancellationToken.None);
        await Client(plex).LibraryItemsAsync(Server, "1", "movie", 0, 30, CancellationToken.None);

        Assert.Equal(120, page.Total);
        Assert.Equal(["Brat"], page.Items.Select(i => i.Title));
        var artist = plex.Requests[0].RequestUri!;
        Assert.Equal("/library/sections/3/all", artist.AbsolutePath);
        Assert.Contains("type=9", artist.Query);
        Assert.Contains("sort=titleSort", artist.Query);
        Assert.Contains("X-Plex-Container-Start=60", artist.Query);
        Assert.Contains("X-Plex-Container-Size=30", artist.Query);
        Assert.DoesNotContain("type=9", plex.Requests[1].RequestUri!.Query);
    }

    [Fact]
    public async Task Libraries_SayHowManyTheyHold_AndWhichFilmsSeriesOrAlbumsAreNewest()
    {
        var plex = new ScriptedPlex(request => request.RequestUri!.AbsolutePath == "/library/sections"
            ? Json(new { MediaContainer = new { Directory = new object[] { new { key = "2", title = "TV Shows", type = "show" } } } })
            : request.RequestUri.AbsolutePath.EndsWith("/recentlyAdded")
                ? Json(new { MediaContainer = new { Metadata = new object[] { new { ratingKey = "9", type = "episode", title = "An episode", addedAt = 1 } } } })
                : Json(new { MediaContainer = new { totalSize = 1234, Metadata = new object[] { new { ratingKey = "5", type = "show", title = "A series", addedAt = 1 } } } }));

        var library = Assert.Single(await Client(plex).LibrariesAsync(Server, 24, CancellationToken.None));

        Assert.Equal(1234, library.Count);
        // What the server lists as new is episodes; the newest series are asked for apart.
        Assert.Equal(["An episode"], library.Recent.Select(i => i.Title));
        Assert.Equal(["A series"], library.Titles.Select(i => i.Title));
        var asked = plex.Requests.Single(r => r.RequestUri!.AbsolutePath == "/library/sections/2/all").RequestUri!;
        Assert.Contains("sort=addedAt%3Adesc", asked.Query);
        Assert.Contains("X-Plex-Container-Size=24", asked.Query);
    }

    [Fact]
    public async Task Search_WithNothingFound_IsEmpty()
    {
        var plex = new ScriptedPlex(_ => Json(new { MediaContainer = new { size = 0 } }));

        Assert.Empty(await Client(plex).SearchAsync(Server, "zzz", null, 12, CancellationToken.None));
        Assert.DoesNotContain("sectionId", plex.Requests.Single().RequestUri!.Query);
    }

    [Fact]
    public async Task Audio_IsTheTracksFirstPart_OrTheShowsTheme_AskedForTheRangeWanted()
    {
        var plex = new ScriptedPlex(request => request.RequestUri!.AbsolutePath switch
        {
            "/library/metadata/7" => Json(new { MediaContainer = new { Metadata = new object[]
                { new { ratingKey = "7", type = "track", Media = new object[] { new { Part = new object[] { new { key = "/library/parts/70/1/file.mp3" } } } } } } } }),
            "/library/metadata/8" => Json(new { MediaContainer = new { Metadata = new object[]
                { new { ratingKey = "8", type = "show", theme = "/library/metadata/8/theme/1" } } } }),
            "/library/metadata/9" => Json(new { MediaContainer = new { Metadata = new object[] { new { ratingKey = "9", type = "show" } } } }),
            "/library/parts/70/1/file.mp3" => new HttpResponseMessage(HttpStatusCode.PartialContent) { Content = new ByteArrayContent([1, 2, 3]) },
            "/library/metadata/8/theme/1" => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([4, 5]) },
            _ => new HttpResponseMessage(HttpStatusCode.NotFound),
        });
        var client = Client(plex);

        var track = await client.AudioAsync(Server, "7", false, "bytes=0-", CancellationToken.None);
        var theme = await client.AudioAsync(Server, "8", true, null, CancellationToken.None);

        Assert.Equal(206, track!.Status);
        using var bytes = new MemoryStream();
        await track.Content.CopyToAsync(bytes);
        Assert.Equal(new byte[] { 1, 2, 3 }, bytes.ToArray());
        Assert.Equal(200, theme!.Status);
        Assert.Equal("bytes=0-", plex.Requests.Single(r => r.RequestUri!.AbsolutePath.EndsWith("file.mp3")).Headers.GetValues("Range").Single());
        // A show without a theme, a theme asked of a track, a track asked as a theme, and something the server doesn't have: nothing.
        Assert.Null(await client.AudioAsync(Server, "9", true, null, CancellationToken.None));
        Assert.Null(await client.AudioAsync(Server, "7", true, null, CancellationToken.None));
        Assert.Null(await client.AudioAsync(Server, "8", false, null, CancellationToken.None));
    }

    [Fact]
    public async Task Tracks_ListTheAudioAndSubtitlesOfTheFirstMedia()
    {
        var plex = new ScriptedPlex(_ => Json(new { MediaContainer = new { Metadata = new object[] { new { Media = new object[] { new { Part = new object[] { new { Stream = new object[]
        {
            new { id = 1, streamType = 1, displayTitle = "1080p (H.264)" },
            new { id = 2, streamType = 2, displayTitle = "English (AC3 5.1)", extendedDisplayTitle = "English (AC3 5.1) (Default)", selected = true },
            new { id = 3, streamType = 2, displayTitle = "Nederlands (AAC Stereo)" },
            new { id = 4, streamType = 3, displayTitle = "English (SRT)" },
        } } } } } } } } }));

        var tracks = await Client(plex).TracksAsync(Server, "100", CancellationToken.None);

        Assert.Equal([("2", "English (AC3 5.1) (Default)", true), ("3", "Nederlands (AAC Stereo)", false)], tracks.Audio.Select(t => (t.Id, t.Label, t.Selected)));
        Assert.Equal([("4", "English (SRT)", false)], tracks.Subtitles.Select(t => (t.Id, t.Label, t.Selected)));
    }

    [Fact]
    public async Task Tracks_OfAnItemWithoutMedia_AreEmpty()
    {
        var plex = new ScriptedPlex(_ => Json(new { MediaContainer = new { Metadata = new object[] { new { ratingKey = "1" } } } }));

        var tracks = await Client(plex).TracksAsync(Server, "1", CancellationToken.None);

        Assert.Empty(tracks.Audio);
        Assert.Empty(tracks.Subtitles);
    }
}
