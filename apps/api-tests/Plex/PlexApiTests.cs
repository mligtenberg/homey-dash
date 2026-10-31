using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Channels;
using HomeyDash.Api.Data;
using HomeyDash.Api.Plex;
using Microsoft.Extensions.DependencyInjection;
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
            if (snapshot.GetProperty("accounts")[0].GetProperty("loaded").GetBoolean() && snapshot.GetProperty("sessions").GetArrayLength() > 0)
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
        var account = snapshot.GetProperty("accounts").EnumerateArray().Single();
        Assert.Equal(["Movies", "TV Shows", "Music"], account.GetProperty("libraries").EnumerateArray().Select(l => l.GetProperty("title").GetString()));
        Assert.Equal("connected", account.GetProperty("status").GetString());
        Assert.Equal("Fake Plex", account.GetProperty("accountName").GetString());
        Assert.All(sessions, s => Assert.Equal(1, s.GetProperty("accountId").GetInt32()));
    }

    [Fact]
    public async Task Pausing_IsPushedToEveryConnection()
    {
        var hub = await ConnectAsync();
        await LoadedSnapshotAsync(hub);
        var pushed = Channel.CreateUnbounded<JsonElement>();
        hub.On<JsonElement>("PlexSessions", sessions => pushed.Writer.TryWrite(sessions));

        await hub.InvokeAsync("ControlPlex", 1, FakePlex.LivingRoomTv, "pause");

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

        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("ControlPlex", 1, "no-such-player", "play"));
        await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("ControlPlex", 2, FakePlex.LivingRoomTv, "play"));
    }

    [Fact]
    public async Task Images_AreOnlyTheLibrarysOwn()
    {
        var poster = await _client.GetAsync("/api/plex/image?path=/library/metadata/101/thumb&w=200&h=300");
        var ofTheAccount = await _client.GetAsync("/api/plex/image?account=1&path=/library/metadata/101/thumb");
        var ofNoAccount = await _client.GetAsync("/api/plex/image?account=2&path=/library/metadata/101/thumb");
        var elsewhere = await _client.GetAsync("/api/plex/image?path=/accounts");

        Assert.Equal(HttpStatusCode.OK, poster.StatusCode);
        Assert.Equal(HttpStatusCode.OK, ofTheAccount.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, ofNoAccount.StatusCode);
        Assert.Equal("image/svg+xml", poster.Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.NotFound, elsewhere.StatusCode);
    }

    [Fact]
    public async Task TheAccount_ShowsWhoAndWhichServer_ButNoToken()
    {
        var text = await _client.GetStringAsync("/api/accounts/plex");
        var info = JsonSerializer.Deserialize<JsonElement>(text);
        var account = info.GetProperty("accounts").EnumerateArray().Single();

        Assert.True(info.GetProperty("fake").GetBoolean());
        Assert.Equal("Fake Plex", account.GetProperty("name").GetString());
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
        object Tile(string id, string kind, string target, int column, int row, int? account = null) =>
            new { id, kind, size = "small", position = new { column, row }, settings = new { target, account } };

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
                        Tile("e", "plex-recent", "plex-library:1", 1, 1, account: 1), Tile("f", "plex-now-playing", "plex-player:any", 2, 1, account: 9),
                    },
                },
            },
        });

        Assert.True(saved.IsSuccessStatusCode);
        var missing = (await _client.GetFromJsonAsync<JsonElement>($"/api/dashboards/{dashboard}")).GetProperty("missingTiles").GetInt32();
        // The library that isn't there, and the tile of an account that isn't.
        Assert.Equal(2, missing);
    }
}

// Against the real Plex client, before anyone signed in.
public class PlexAccountApiTests(RealPlexApiFactory factory) : IClassFixture<RealPlexApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task WithoutASignIn_ThereIsNoServerOrImage()
    {
        var info = await _client.GetFromJsonAsync<JsonElement>("/api/accounts/plex");

        Assert.Equal(0, info.GetProperty("accounts").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/accounts/plex/1/servers")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await _client.GetAsync("/api/plex/image?path=/library/metadata/1/thumb")).StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("  ")]
    public async Task ANewAccount_NeedsAName(string? name)
    {
        var response = await _client.PostAsJsonAsync("/api/accounts/plex/sign-in", new { name });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task SigningInAgain_NeedsAnAccountThatExists()
    {
        var response = await _client.PostAsJsonAsync("/api/accounts/plex/sign-in", new { accountId = 5 });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Accounts_AreRenamedAndRemovedOneByOne()
    {
        int[] ids;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
            var seeded = new[] { new PlexAccount("c1", "t1", "anna") { Name = "Living room" }, new PlexAccount("c2", "t2", "bram") { Name = "Attic" } };
            db.PlexAccounts.AddRange(seeded);
            await db.SaveChangesAsync();
            scope.ServiceProvider.GetRequiredService<PlexAccounts>().Set(db.PlexAccounts.ToList());
            ids = [.. seeded.Select(a => a.Id)];
        }

        var taken = await _client.PutAsJsonAsync($"/api/accounts/plex/{ids[1]}", new { name = "living room" });
        var renamed = await _client.PutAsJsonAsync($"/api/accounts/plex/{ids[1]}", new { name = "Cinema" });
        var removed = await _client.DeleteAsync($"/api/accounts/plex/{ids[0]}");

        Assert.Equal(HttpStatusCode.BadRequest, taken.StatusCode);
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
        var accounts = (await _client.GetFromJsonAsync<JsonElement>("/api/accounts/plex")).GetProperty("accounts").EnumerateArray().ToList();
        Assert.Equal(["Cinema"], accounts.Select(a => a.GetProperty("name").GetString()));
        Assert.DoesNotContain("t2", await _client.GetStringAsync("/api/accounts/plex"));
    }
}
