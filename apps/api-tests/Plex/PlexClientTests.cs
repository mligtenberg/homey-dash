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
}
