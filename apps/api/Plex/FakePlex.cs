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
        PlexItem Item(int n, string kind, string title, string? subtitle, string? summary = null, int? year = null,
            long? minutes = null, double? rating = null, string? contentRating = null, params string[] genres) =>
            new($"{n}", kind, title, subtitle, $"/library/metadata/{n}/thumb", now.AddDays(-n % 100))
            {
                Summary = summary, Year = year, DurationMs = minutes * 60_000, Rating = rating, ContentRating = contentRating,
                Genres = genres, Art = $"/library/metadata/{n}/art",
            };
        return Task.FromResult<IReadOnlyList<PlexLibrary>>(
        [
            new PlexLibrary("1", "Movies", "movie",
                [
                    Item(101, "movie", "Dune: Part Two", "2024", "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the known universe, he endeavors to prevent a terrible future only he can foresee.",
                        2024, 166, 8.4, "PG-13", "Science Fiction", "Adventure", "Drama"),
                    Item(102, "movie", "Past Lives", "2023", "Nora and Hae Sung, two childhood friends, are reunited in New York for one fateful week as they confront notions of love and destiny.",
                        2023, 106, 8.0, "PG-13", "Drama", "Romance"),
                    Item(103, "movie", "Perfect Days", "2023", "Hirayama seems content with his simple life as a toilet cleaner in Tokyo.",
                        2023, 124, 7.9, "PG", "Drama"),
                ]),
            new PlexLibrary("2", "TV Shows", "show",
                [
                    Item(202, "episode", "Next", "The Bear · S3 E2", "Carmy and Sydney race to get the restaurant ready as tensions rise in the kitchen.", 2024, 33, 8.6, "TV-MA", "Comedy", "Drama"),
                    Item(203, "season", "Shōgun", "Season 1", "In 1600 Japan, a mysterious European ship is found marooned in a nearby fishing village.", 2024, null, 9.1, "TV-MA", "Drama", "History"),
                ]),
            new PlexLibrary("3", "Music", "artist", [Item(301, "album", "Hit Me Hard and Soft", "Billie Eilish", year: 2024, genres: ["Pop"])]),
        ]);
    }

    // Everything the fake library holds: the newest above, and older things that only a search finds.
    private async Task<List<(string Library, PlexItem Item)>> CatalogAsync(CancellationToken ct)
    {
        var now = time.GetUtcNow();
        PlexItem Older(int n, string kind, string title, string? subtitle, int year, long? minutes) =>
            new($"{n}", kind, title, subtitle, $"/library/metadata/{n}/thumb", now.AddDays(-400 - n))
            {
                Summary = $"{title}, from {year}.", Year = year, DurationMs = minutes * 60_000, Rating = 7.5, ContentRating = "PG-13", Genres = ["Drama"],
                Art = $"/library/metadata/{n}/art",
            };
        var catalog = (await LibrariesAsync(new PlexConnection("", "", ""), 24, ct)).SelectMany(l => l.Recent.Select(i => (l.Id, i))).ToList();
        catalog.AddRange(
        [
            ("1", Older(401, "movie", "Arrival", "2016", 2016, 116)),
            ("1", Older(402, "movie", "Blade Runner 2049", "2017", 2017, 164)),
            ("1", Older(403, "movie", "Dune", "1984", 1984, 137)),
            ("2", Older(500, "show", "The Bear", "2022", 2022, null)),
            ("2", Older(501, "episode", "System", "The Bear · S1 E1", 2022, 28)),
            ("3", Older(601, "album", "Happier Than Ever", "Billie Eilish", 2021, null)),
        ]);
        return catalog;
    }

    public async Task<IReadOnlyList<PlexItem>> SearchAsync(PlexConnection server, string query, string? libraryId, int limit, CancellationToken ct) =>
        (await CatalogAsync(ct))
        .Where(c => libraryId is null || c.Library == libraryId)
        .Where(c => c.Item.Title.Contains(query, StringComparison.OrdinalIgnoreCase) || c.Item.Subtitle?.Contains(query, StringComparison.OrdinalIgnoreCase) == true)
        .Select(c => c.Item).Take(limit * 3).ToList();

    public Task<PlexTracks> TracksAsync(PlexConnection server, string itemId, CancellationToken ct) =>
        Task.FromResult(new PlexTracks(
            [new PlexTrack("1", "English (AC3 5.1)", true), new PlexTrack("2", "Nederlands (AAC Stereo)", false), new PlexTrack("3", "Japanese (DTS-HD MA 7.1)", false)],
            [new PlexTrack("11", "English (SRT)", false), new PlexTrack("12", "Nederlands (SRT)", false), new PlexTrack("13", "English (PGS)", false)]));

    public async Task<PlexItem?> ItemAsync(PlexConnection server, string itemId, CancellationToken ct) =>
        (await CatalogAsync(ct)).Select(c => c.Item).FirstOrDefault(i => i.Id == itemId);

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
