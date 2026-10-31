using System.Text;

namespace HomeyDash.Api.Plex;

/// <summary>
/// A plex.tv and Plex server that need neither, used when the configuration sets Plex:Fake. A pin is approved the
/// first time it is checked, and the account has one server. A movie plays in the living room and an episode is paused
/// on the iPad; commands to them work. Pictures are soft gradients with their title, drawn as SVG.
/// </summary>
public sealed class FakePlex(TimeProvider time) : IPlex
{
    public const string Username = "fake-plex";
    public const string ServerId = "fake-server";
    public const string LivingRoomTv = "fake-living-room-tv";
    public const string Ipad = "fake-ipad";

    public static readonly PlexAccount Account = new("fake-client", "fake-token", Username)
    {
        Id = 1, Name = "Fake Plex", ServerId = ServerId, ServerName = "Fake Plex", ServerUri = "http://fake-plex:32400", ServerToken = "fake-token",
    };

    private readonly Lock _lock = new();
    private readonly Dictionary<string, (string State, long OffsetMs, DateTimeOffset At)> _players = new()
    {
        [LivingRoomTv] = ("playing", 3_600_000, DateTimeOffset.MinValue),
        [Ipad] = ("paused", 900_000, DateTimeOffset.MinValue),
    };

    public Task<PlexPin> CreatePinAsync(string clientId, CancellationToken ct) =>
        Task.FromResult(new PlexPin(1, "FAKE", new Uri("about:blank")));

    public Task<string?> CheckPinAsync(string clientId, long pinId, CancellationToken ct) => Task.FromResult<string?>("fake-token");

    public Task<string?> UsernameAsync(string clientId, string token, CancellationToken ct) => Task.FromResult<string?>(Username);

    public Task<IReadOnlyList<PlexServerChoice>> ServersAsync(string clientId, string token, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<PlexServerChoice>>(
            [new PlexServerChoice(ServerId, "Fake Plex", true, "fake-token", [new PlexServerAddress("http://fake-plex:32400", true, false)])]);

    public Task<string> ConnectAsync(string clientId, PlexServerChoice server, CancellationToken ct) =>
        Task.FromResult(server.Addresses[0].Uri);

    public Task<IReadOnlyList<PlexSession>> SessionsAsync(PlexConnection server, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        lock (_lock)
        {
            return Task.FromResult<IReadOnlyList<PlexSession>>(
            [
                new PlexSession("1", "movie", "Dune: Part Two", "2024", "/library/metadata/101/thumb", "/library/metadata/101/art",
                    9_960_000, Offset(LivingRoomTv, now), now, _players[LivingRoomTv].State, "Martin", LivingRoomTv, "Living room TV"),
                new PlexSession("2", "episode", "Next", "The Bear · S3 E2", "/library/metadata/202/thumb", "/library/metadata/202/art",
                    1_920_000, Offset(Ipad, now), now, _players[Ipad].State, "Sam", Ipad, "iPad"),
            ]);
        }
    }

    public Task<IReadOnlyList<PlexLibrary>> LibrariesAsync(PlexConnection server, int recent, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        PlexItem Item(int n, string kind, string title, string? subtitle) =>
            new($"{n}", kind, title, subtitle, $"/library/metadata/{n}/thumb", now.AddDays(-n % 100));
        return Task.FromResult<IReadOnlyList<PlexLibrary>>(
        [
            new PlexLibrary("1", "Movies", "movie",
                [Item(101, "movie", "Dune: Part Two", "2024"), Item(102, "movie", "Past Lives", "2023"), Item(103, "movie", "Perfect Days", "2023")]),
            new PlexLibrary("2", "TV Shows", "show",
                [Item(202, "episode", "Next", "The Bear · S3 E2"), Item(203, "season", "Shōgun", "Season 1")]),
            new PlexLibrary("3", "Music", "artist", [Item(301, "album", "Hit Me Hard and Soft", "Billie Eilish")]),
        ]);
    }

    public Task<(Stream Content, string ContentType)?> ImageAsync(PlexConnection server, string path, int width, int height, CancellationToken ct)
    {
        var n = path.Split('/').Select(part => int.TryParse(part, out var number) ? number : 0).FirstOrDefault(number => number > 0);
        var hue = n * 47 % 360;
        var svg = $"""
            <svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
              <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="hsl({hue},55%,45%)"/><stop offset="1" stop-color="hsl({(hue + 40) % 360},60%,18%)"/>
              </linearGradient></defs>
              <rect width="100%" height="100%" fill="url(#g)"/>
              <text x="50%" y="50%" fill="#fff" fill-opacity="0.8" font-family="sans-serif" font-size="{Math.Min(width, height) / 5}"
                text-anchor="middle" dominant-baseline="central">{n}</text>
            </svg>
            """;
        return Task.FromResult<(Stream, string)?>((new MemoryStream(Encoding.UTF8.GetBytes(svg)), "image/svg+xml"));
    }

    public Task ControlAsync(PlexConnection server, string playerId, PlexCommand command, string kind, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        lock (_lock)
        {
            if (!_players.ContainsKey(playerId)) throw new PlexException("That player isn't playing anything.");
            var offset = Offset(playerId, now);
            _players[playerId] = command switch
            {
                PlexCommand.Play => ("playing", offset, now),
                PlexCommand.Pause => ("paused", offset, now),
                // Skipping starts the item over; the fake has nothing next.
                _ => (_players[playerId].State, 0, now),
            };
        }
        return Task.CompletedTask;
    }

    // Where a player is now: playing moves on from where it was told last.
    private long Offset(string playerId, DateTimeOffset now)
    {
        var (state, offset, at) = _players[playerId];
        return state == "playing" && at != DateTimeOffset.MinValue ? offset + (long)(now - at).TotalMilliseconds : offset;
    }
}
