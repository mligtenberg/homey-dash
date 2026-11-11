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
            [new PlexServerChoice(ServerId, "Fake Plex", true, token, [new PlexServerAddress("http://fake-plex:32400", true, false)])]);

    // A home of three: the owner, one more, and Kids, which asks for the PIN 1234.
    public const string KidsPin = "1234";

    private static readonly PlexProfile[] Home = [new("1", Username, true, false), new("2", "Sam", false, false), new("3", "Kids", false, true)];

    public Task<IReadOnlyList<PlexProfile>> ProfilesAsync(string clientId, string token, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<PlexProfile>>(Home);

    public Task<string> SwitchProfileAsync(string clientId, string token, string profileId, string? pin, CancellationToken ct)
    {
        if (Home.FirstOrDefault(p => p.Id == profileId) is not { } profile) throw new PlexException("That profile is not in the home.");
        if (profile.Protected && pin != KidsPin) throw new PlexException("That PIN is not right.");
        return Task.FromResult(profile.Admin ? "fake-token" : $"fake-token-{profile.Id}");
    }

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
                Genres = genres, Cast = kind is "movie" or "show" ? [new("Ada Lovelace", "The Engineer", $"/library/metadata/{n}/thumb"), new("Grace Hopper", "The Captain", null)] : [], Art = $"/library/metadata/{n}/art", Watched = Seen.Contains($"{n}"),
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

    public async Task<PlexPerson> PersonAsync(PlexConnection server, PlexActor actor, CancellationToken ct)
    {
        // Ada Lovelace and Grace Hopper are in every film and series that lists them.
        var works = (await CatalogAsync(ct)).Select(c => c.Item).Where(i => i.Cast.Any(a => a.Name == actor.Name)).ToList();
        return new PlexPerson(actor.Name, actor.Image, $"{actor.Name} appears in {works.Count} titles.", "10 December 1815", "27 November 1852 (aged 36)", "London, England", "Actor, Producer", works);
    }

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

    // What screens reported, to see in tests; the fake server keeps nothing of it.
    public List<(string ItemId, string State, long TimeMs)> Reports { get; } = [];

    public Task ReportAsync(PlexConnection server, string itemId, string state, long timeMs, long durationMs, CancellationToken ct)
    {
        lock (Reports) Reports.Add((itemId, state, timeMs));
        return Task.CompletedTask;
    }

    // A twenty second clip of a square crossing a dark picture, the same for every film and episode.
    public async Task<PlexAudio?> VideoAsync(PlexConnection server, string itemId, CancellationToken ct)
    {
        if ((await CatalogAsync(ct)).Select(c => c.Item).FirstOrDefault(i => i.Id == itemId) is not { Kind: "movie" or "episode" }) return null;
        var clip = Convert.FromBase64String(Clip);
        return new PlexAudio(new MemoryStream(clip), "video/mp4", 200, clip.Length, null);
    }

    private const string Clip = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAktbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAATiAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAACFh0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAATiAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAUAAAAC0AAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAE4gAAAIAAABAAAAAAfQbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAADIABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAHe21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAABztzdGJsAAAAw3N0c2QAAAAAAAAAAQAAALNhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAUAAtABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAAOWF2Y0MBZAAV/+EAG2dkABWscgRBQZ+fARAAAAMAEAAAAwFA8WLYRgEAB2joQ4JSyLD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAABkgAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAMgAAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAALgY3R0cwAAAAAAAABaAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAwAAAAAAAAAEAAAEAAAAAAEAACgAAAAAAQAAEAAAAAADAAAAAAAAAAQAAAQAAAAAAQAAKAAAAAABAAAQAAAAAAMAAAAAAAAABAAABAAAAAABAAAoAAAAAAEAABAAAAAAAwAAAAAAAAAEAAAEAAAAAAEAACgAAAAAAQAAEAAAAAADAAAAAAAAAAQAAAQAAAAAAQAAKAAAAAABAAAQAAAAAAMAAAAAAAAABAAABAAAAAABAAAoAAAAAAEAABAAAAAAAwAAAAAAAAAEAAAEAAAAAAEAACgAAAAAAQAAEAAAAAADAAAAAAAAAAQAAAQAAAAAAQAAKAAAAAABAAAQAAAAAAMAAAAAAAAABAAABAAAAAABAAAoAAAAAAEAABAAAAAAAwAAAAAAAAAEAAAEAAAAAAEAACgAAAAAAQAAEAAAAAADAAAAAAAAAAQAAAQAAAAAAQAAKAAAAAABAAAQAAAAAAMAAAAAAAAABAAABAAAAAABAAAoAAAAAAEAABAAAAAAAwAAAAAAAAAEAAAEAAAAAAEAACgAAAAAAQAAEAAAAAADAAAAAAAAAAQAAAQAAAAAAQAAKAAAAAABAAAQAAAAAAMAAAAAAAAABAAABAAAAAABAAAoAAAAAAEAABAAAAAAAwAAAAAAAAAEAAAEAAAAAAEAACgAAAAAAQAAEAAAAAADAAAAAAAAAAQAAAQAAAAAAQAAKAAAAAABAAAQAAAAAAMAAAAAAAAABAAABAAAAAABAAAoAAAAAAEAABAAAAAAAwAAAAAAAAAEAAAEAAAAAAEAACgAAAAAAQAAEAAAAAADAAAAAAAAAAQAAAQAAAAAAQAAKAAAAAABAAAQAAAAAAMAAAAAAAAABAAABAAAAAABAAAoAAAAAAEAABAAAAAAAwAAAAAAAAAEAAAEAAAAAAEAAAgAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAADIAAAAAQAAAzRzdHN6AAAAAAAAAAAAAADIAAADTgAAABAAAAAOAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAABYAAAAOAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAABcAAAAOAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAABkAAAAOAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAABoAAAAOAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAABwAAAAOAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAAB4AAAAOAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAAB8AAAARAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAAB8AAAARAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAAB8AAAAR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";

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
