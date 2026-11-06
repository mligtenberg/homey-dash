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

    // What this account played: two films, three episodes, and so the second season of The Bear, whose one episode it is.
    private static readonly HashSet<string> Seen = ["102", "401", "501", "520", "522", "511"];

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

    public async Task<IReadOnlyList<PlexLibrary>> LibrariesAsync(PlexConnection server, int recent, CancellationToken ct)
    {
        var catalog = await CatalogAsync(ct);
        return Newest().Select(l =>
        {
            var titles = catalog.Where(c => c.Library == l.Id && IsTopLevel(c.Item)).Select(c => c.Item).ToList();
            return l with { Count = titles.Count, Titles = titles.OrderByDescending(i => i.AddedAt).Take(recent).ToList() };
        }).ToList();
    }

    // What a library lists at the top: films, series and albums, not what is under them.
    private static bool IsTopLevel(PlexItem item) => item.Kind is "movie" or "show" or "album";

    private IReadOnlyList<PlexLibrary> Newest()
    {
        var now = time.GetUtcNow();
        PlexItem Item(int n, string kind, string title, string? subtitle, string? summary = null, int? year = null,
            long? minutes = null, double? rating = null, string? contentRating = null, params string[] genres) =>
            new($"{n}", kind, title, subtitle, $"/library/metadata/{n}/thumb", now.AddDays(-n % 100))
            {
                Summary = summary, Year = year, DurationMs = minutes * 60_000, Rating = rating, ContentRating = contentRating,
                Genres = genres, Art = $"/library/metadata/{n}/art", Watched = Seen.Contains($"{n}"),
            };
        return
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
        ];
    }

    // Everything the fake library holds: the newest above, older things that only a search finds, and what is under a show,
    // season or album, which is reached through it.
    private Task<List<(string Library, PlexItem Item)>> CatalogAsync(CancellationToken ct)
    {
        var now = time.GetUtcNow();
        PlexItem Older(int n, string kind, string title, string? subtitle, int year, long? minutes, int? index = null) =>
            new($"{n}", kind, title, subtitle, $"/library/metadata/{n}/thumb", now.AddDays(-400 - n))
            {
                Summary = $"{title}, from {year}.", Year = year, DurationMs = minutes * 60_000, Rating = 7.5, ContentRating = "PG-13", Genres = ["Drama"],
                Art = $"/library/metadata/{n}/art", Index = index, Watched = Seen.Contains($"{n}"),
            };
        var catalog = Newest().SelectMany(l => l.Recent.Select(i => (l.Id, i))).ToList();
        catalog.AddRange(
        [
            ("1", Older(401, "movie", "Arrival", "2016", 2016, 116)),
            ("1", Older(402, "movie", "Blade Runner 2049", "2017", 2017, 164)),
            ("1", Older(403, "movie", "Dune", "1984", 1984, 137)),
            ("2", Older(500, "show", "The Bear", "2022", 2022, null)),
            ("2", Older(501, "episode", "System", "The Bear · S1 E1", 2022, 28, 1)),
            ("2", Older(520, "episode", "Hands", "The Bear · S1 E2", 2022, 21, 2)),
            ("2", Older(521, "episode", "Brigade", "The Bear · S1 E3", 2022, 27, 3)),
            ("2", Older(510, "season", "Season 1", "3 episodes", 2022, null, 1)),
            ("2", Older(511, "season", "Season 2", "1 episode", 2023, null, 2)),
            ("2", Older(522, "episode", "Beef", "The Bear · S2 E1", 2023, 31, 1)),
            ("2", Older(530, "episode", "Anjin", "Shōgun · S1 E1", 2024, 59, 1)),
            ("2", Older(531, "episode", "Servants of Two Masters", "Shōgun · S1 E2", 2024, 58, 2)),
            ("3", Older(601, "album", "Happier Than Ever", "Billie Eilish", 2021, null)),
            ("3", Older(311, "track", "SKINNY", "Billie Eilish — Hit Me Hard and Soft", 2024, 3, 1)),
            ("3", Older(312, "track", "LUNCH", "Billie Eilish — Hit Me Hard and Soft", 2024, 3, 2)),
            ("3", Older(313, "track", "CHIHIRO", "Billie Eilish — Hit Me Hard and Soft", 2024, 5, 3)),
            ("3", Older(611, "track", "Getting Older", "Billie Eilish — Happier Than Ever", 2021, 4, 1)),
            ("3", Older(612, "track", "I Didn't Change My Number", "Billie Eilish — Happier Than Ever", 2021, 3, 2)),
            ("3", Older(613, "track", "Happier Than Ever", "Billie Eilish — Happier Than Ever", 2021, 5, 3)),
            ("1", Older(404, "movie", "Anora", "2024", 2024, 139)),
            ("1", Older(405, "movie", "Oppenheimer", "2023", 2023, 181)),
            ("2", Older(502, "show", "Severance", "2022", 2022, null)),
            ("2", Older(503, "show", "Slow Horses", "2022", 2022, null)),
            ("2", Older(504, "show", "Andor", "2022", 2022, null)),
            ("3", Older(602, "album", "Brat", "Charli xcx", 2024, null)),
            ("3", Older(603, "album", "Short n' Sweet", "Sabrina Carpenter", 2024, null)),
        ]);
        return Task.FromResult(catalog);
    }

    // Under a show, season or album; the numbers there are the ones a track or episode has in it.
    private static readonly Dictionary<string, string[]> Under = new()
    {
        ["500"] = ["510", "511"],
        ["510"] = ["501", "520", "521"],
        ["511"] = ["522"],
        ["203"] = ["530", "531"],
        ["301"] = ["311", "312", "313"],
        ["601"] = ["611", "612", "613"],
    };

    public async Task<PlexPage> LibraryItemsAsync(PlexConnection server, string libraryId, string libraryType, int start, int size, CancellationToken ct)
    {
        var all = (await CatalogAsync(ct)).Where(c => c.Library == libraryId && IsTopLevel(c.Item)).Select(c => c.Item)
            .OrderBy(i => i.Title, StringComparer.OrdinalIgnoreCase).ToList();
        return new PlexPage(all.Skip(start).Take(size).ToList(), all.Count);
    }

    public async Task<IReadOnlyList<PlexItem>> SearchAsync(PlexConnection server, string query, string? libraryId, int limit, CancellationToken ct) =>
        (await CatalogAsync(ct))
        .Where(c => libraryId is null || c.Library == libraryId)
        .Where(c => c.Item.Kind switch
        {
            // Reached through their show, not searched for.
            "season" => false,
            // An episode or a track is found by its own name, not its show's or its album's.
            "episode" or "track" => PlexSearch.Matches(c.Item.Title, query),
            _ => c.Item.Title.Contains(query, StringComparison.OrdinalIgnoreCase) || c.Item.Subtitle?.Contains(query, StringComparison.OrdinalIgnoreCase) == true,
        })
        .Select(c => c.Item).Take(limit * 5).ToList();

    public async Task<IReadOnlyList<PlexItem>> ChildrenAsync(PlexConnection server, string itemId, CancellationToken ct)
    {
        if (!Under.TryGetValue(itemId, out var ids)) return [];
        var catalog = (await CatalogAsync(ct)).Select(c => c.Item).ToList();
        return ids.Select(id => catalog.First(i => i.Id == id)).Select(i => i.Kind switch
        {
            // As the real server lists them: a season by its name, an episode or track by its own.
            "season" => i,
            _ => i with { Subtitle = null },
        }).ToList();
    }

    public Task<PlexTracks> TracksAsync(PlexConnection server, string itemId, CancellationToken ct) =>
        Task.FromResult(new PlexTracks(
            [new PlexTrack("1", "English (AC3 5.1)", true), new PlexTrack("2", "Nederlands (AAC Stereo)", false), new PlexTrack("3", "Japanese (DTS-HD MA 7.1)", false)],
            [new PlexTrack("11", "English (SRT)", false), new PlexTrack("12", "Nederlands (SRT)", false), new PlexTrack("13", "English (PGS)", false)]));

    public async Task<PlexItem?> ItemAsync(PlexConnection server, string itemId, CancellationToken ct) =>
        (await CatalogAsync(ct)).Select(c => c.Item).FirstOrDefault(i => i.Id == itemId);

    // A tone a few seconds long, higher for each item, so a screen has something to play: for a track, and for the theme of a show.
    public async Task<PlexAudio?> AudioAsync(PlexConnection server, string itemId, bool theme, string? range, CancellationToken ct)
    {
        var kind = theme ? "show" : "track";
        if ((await CatalogAsync(ct)).Select(c => c.Item).FirstOrDefault(i => i.Id == itemId) is not { } item || item.Kind != kind) return null;
        const int rate = 8000, seconds = 3;
        var frequency = 220 + int.Parse(item.Id) % 12 * 40;
        var samples = Enumerable.Range(0, rate * seconds)
            .Select(n => (byte)(128 + 60 * Math.Sin(2 * Math.PI * frequency * n / rate) * Math.Min(1, Math.Min(n, rate * seconds - n) / 400.0))).ToArray();
        using var wav = new MemoryStream();
        using (var w = new BinaryWriter(wav, Encoding.ASCII, leaveOpen: true))
        {
            w.Write("RIFF"u8); w.Write(36 + samples.Length); w.Write("WAVEfmt "u8); w.Write(16); w.Write((short)1); w.Write((short)1);
            w.Write(rate); w.Write(rate); w.Write((short)1); w.Write((short)8); w.Write("data"u8); w.Write(samples.Length); w.Write(samples);
        }
        return new PlexAudio(new MemoryStream(wav.ToArray()), "audio/wav", 200, wav.Length, null);
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
