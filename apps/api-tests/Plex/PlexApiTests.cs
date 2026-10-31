using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Channels;
using HomeyDash.Api.Plex;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

namespace HomeyDash.Api.Tests.Plex;

// Against FakePlex: a movie plays on the living room TV, an episode is paused on the iPad.
public sealed class PlexApiTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private readonly HttpClient _client = factory.CreateClient();
    private HubConnection? _hub;

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (_hub is not null) await _hub.DisposeAsync();
    }

    // Long polling, because the in-memory test server has no WebSockets for the SignalR client.
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

    // The watcher's first look takes a moment after startup.
    private static async Task<JsonElement> LoadedSnapshotAsync(HubConnection hub)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (true)
        {
            var snapshot = await hub.InvokeAsync<JsonElement>("Plex");
            if (snapshot.GetProperty("overview").GetProperty("loaded").GetBoolean() && snapshot.GetProperty("sessions").GetArrayLength() > 0)
                return snapshot;
            if (DateTime.UtcNow > deadline) throw new TimeoutException("Plex did not load within 5 seconds");
            await Task.Delay(50);
        }
    }

    [Fact]
    public async Task TheSnapshot_HasWhatPlaysAndTheLibraries()
    {
        var snapshot = await LoadedSnapshotAsync(await ConnectAsync());

        var sessions = snapshot.GetProperty("sessions").EnumerateArray().ToList();
        // Other tests pause and play the movie, so only the episode's state is certain.
        Assert.Contains(sessions, s => s.GetProperty("title").GetString() == "Dune: Part Two" && s.GetProperty("playerName").GetString() == "Living room TV");
        Assert.Contains(sessions, s => s.GetProperty("subtitle").GetString() == "The Bear · S3 E2" && s.GetProperty("state").GetString() == "paused");
        Assert.Equal(["Movies", "TV Shows", "Music"],
            snapshot.GetProperty("overview").GetProperty("libraries").EnumerateArray().Select(l => l.GetProperty("title").GetString()));
        Assert.Equal("connected", snapshot.GetProperty("overview").GetProperty("status").GetString());
    }

    [Fact]
    public async Task Pausing_IsPushedToEveryConnection()
    {
        var hub = await ConnectAsync();
        await LoadedSnapshotAsync(hub);
        var pushed = Channel.CreateUnbounded<JsonElement>();
        hub.On<JsonElement>("PlexSessions", sessions => pushed.Writer.TryWrite(sessions));

        await hub.InvokeAsync("ControlPlex", FakePlex.LivingRoomTv, "pause");

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (true)
        {
            var sessions = await pushed.Reader.ReadAsync(timeout.Token);
            if (sessions.EnumerateArray().Any(s => s.GetProperty("playerId").GetString() == FakePlex.LivingRoomTv
                && s.GetProperty("state").GetString() == "paused")) break;
        }
    }

    [Fact]
    public async Task ControllingAPlayerThatPlaysNothing_IsRefused()
    {
        var hub = await ConnectAsync();
        await LoadedSnapshotAsync(hub);

        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("ControlPlex", "no-such-player", "play"));
    }

    [Fact]
    public async Task Images_AreOnlyTheLibrarysOwn()
    {
        var poster = await _client.GetAsync("/api/plex/image?path=/library/metadata/101/thumb&w=200&h=300");
        var elsewhere = await _client.GetAsync("/api/plex/image?path=/accounts");

        Assert.Equal(HttpStatusCode.OK, poster.StatusCode);
        Assert.Equal("image/svg+xml", poster.Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.NotFound, elsewhere.StatusCode);
    }

    [Fact]
    public async Task TheAccount_ShowsWhoAndWhichServer_ButNoToken()
    {
        var text = await _client.GetStringAsync("/api/accounts/plex");
        var account = JsonSerializer.Deserialize<JsonElement>(text);

        Assert.True(account.GetProperty("fake").GetBoolean());
        Assert.Equal(FakePlex.Username, account.GetProperty("username").GetString());
        Assert.Equal("Fake Plex", account.GetProperty("serverName").GetString());
        Assert.DoesNotContain("fake-token", text);
    }

    [Fact]
    public async Task PlexTargets_AreMissingOnlyWhenTheirLibraryIsGone()
    {
        var hub = await ConnectAsync();
        await LoadedSnapshotAsync(hub);
        var dashboard = (await (await _client.PostAsJsonAsync("/api/dashboards", new { name = "Den" }))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        object Tile(string id, string kind, string target, int column, int row) =>
            new { id, kind, size = "small", position = new { column, row }, settings = new { target } };

        var saved = await _client.PutAsJsonAsync($"/api/dashboards/{dashboard}/draft", new
        {
            rows = 4,
            sections = new[]
            {
                new
                {
                    id = "s", title = (string?)null,
                    tiles = new[]
                    {
                        Tile("a", "plex-now-playing", "plex-player:any", 0, 0), Tile("b", "plex-now-playing", "plex-player:gone-tv", 1, 0),
                        Tile("c", "plex-recent", "plex-library:1", 2, 0), Tile("d", "plex-recent", "plex-library:99", 0, 1),
                    },
                },
            },
        });

        Assert.True(saved.IsSuccessStatusCode);
        var missing = (await _client.GetFromJsonAsync<JsonElement>($"/api/dashboards/{dashboard}")).GetProperty("missingTiles").GetInt32();
        Assert.Equal(1, missing);
    }
}

// Against the real Plex client, before anyone signed in.
public class PlexAccountApiTests(RealPlexApiFactory factory) : IClassFixture<RealPlexApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task WithoutASignIn_ThereIsNoServerOrImage()
    {
        var account = await _client.GetFromJsonAsync<JsonElement>("/api/accounts/plex");

        Assert.False(account.GetProperty("signedIn").GetBoolean());
        Assert.Equal(HttpStatusCode.Conflict, (await _client.GetAsync("/api/accounts/plex/servers")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await _client.GetAsync("/api/plex/image?path=/library/metadata/1/thumb")).StatusCode);
    }
}
