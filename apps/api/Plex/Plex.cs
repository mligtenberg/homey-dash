namespace HomeyDash.Api.Plex;

// The Plex section of the configuration.
public sealed class PlexOptions
{
    // Runs against FakePlex instead of plex.tv and a Plex server, for development and tests. Never a fallback.
    public bool Fake { get; set; }
}

/// <summary>
/// A Plex account (ADR-0009): the token HomeyDash got when someone signed in with Plex, the client identifier it
/// signed in as, and the server it shows. ServerId is null until someone chooses one of several servers. Set up in
/// Management and kept in the database; a home can have several, told apart by their names, such as one per server.
/// </summary>
public sealed record PlexAccount(string ClientId, string Token, string? Username)
{
    public int Id { get; init; }
    public string Name { get; init; } = "Plex";
    public string? ServerId { get; init; }
    public string? ServerName { get; init; }
    public string? ServerUri { get; init; }
    // A server shared with the account has a token of its own.
    public string? ServerToken { get; init; }

    public PlexConnection? Connection =>
        ServerUri is null || ServerToken is null ? null : new PlexConnection(ServerUri, ServerToken, ClientId);
}

// The Plex accounts in use, oldest first. Only the fake's when the configuration sets Plex:Fake.
public sealed class PlexAccounts
{
    private volatile IReadOnlyList<PlexAccount> _all = [];

    // Raised after the accounts changed, for the watcher to start or stop watching them.
    public event Action? Changed;

    public IReadOnlyList<PlexAccount> All => _all;

    // The oldest, which a Plex tile shows unless its settings name another.
    public PlexAccount? Default => _all.FirstOrDefault();

    public PlexAccount? Find(int? id) => id is null ? null : _all.FirstOrDefault(a => a.Id == id);

    // The tile's account (settings.account), or the oldest when it names none.
    public PlexAccount? For(int? id) => id is null ? Default : Find(id);

    public void Set(IEnumerable<PlexAccount> accounts)
    {
        _all = accounts.OrderBy(a => a.Id).ToList();
        Changed?.Invoke();
    }
}

// Where to reach the chosen Plex server, and as whom.
public sealed record PlexConnection(string Uri, string Token, string ClientId);

// A sign-in waiting on plex.tv: someone approves Code at AuthUrl.
public sealed record PlexPin(long Id, string Code, Uri AuthUrl);

// A Plex Media Server the account can use, with every address plex.tv knows for it.
public sealed record PlexServerChoice(string Id, string Name, bool Owned, string AccessToken, IReadOnlyList<PlexServerAddress> Addresses);

public sealed record PlexServerAddress(string Uri, bool Local, bool Relay);

/// <summary>
/// Something playing on a Plex player now. Kind is movie, episode, track or other. Image is a path on the server, for
/// /api/plex/image. OffsetMs is where it was at At; while State is playing it moves on from there.
/// </summary>
public sealed record PlexSession(
    string Id, string Kind, string Title, string? Subtitle, string? Image, string? Art, long DurationMs, long OffsetMs,
    DateTimeOffset At, string State, string? User, string PlayerId, string PlayerName)
{
    // The account whose server plays it.
    public int AccountId { get; init; }
}

// A player that played something since HomeyDash started, for a now-playing tile to follow.
public sealed record PlexPlayer(string Id, string Name);

// Something in a library: a movie, show, episode, season or album. AddedAt is when it was added (the epoch when unknown).
public sealed record PlexItem(string Id, string Kind, string Title, string? Subtitle, string? Image, DateTimeOffset AddedAt)
{
    // What the detail view of a cover shows, when the server has it.
    public string? Summary { get; init; }
    public int? Year { get; init; }
    public long? DurationMs { get; init; }
    // Out of ten: the audience's, else the critics'.
    public double? Rating { get; init; }
    public string? ContentRating { get; init; }
    public IReadOnlyList<string> Genres { get; init; } = [];
    // The wide artwork behind it.
    public string? Art { get; init; }
}

// An audio or subtitle track of an item. Label says language, format and channels (English (AC3 5.1)); Selected is the one
// Plex plays when asked for none in particular.
public sealed record PlexTrack(string Id, string Label, bool Selected);

public sealed record PlexTracks(IReadOnlyList<PlexTrack> Audio, IReadOnlyList<PlexTrack> Subtitles);

public sealed record PlexLibrary(string Id, string Title, string Type, IReadOnlyList<PlexItem> Recent);

// What a Plex player can be told to do.
public enum PlexCommand { Play, Pause, SkipNext, SkipPrevious }

/// <summary>What HomeyDash does with plex.tv and a Plex server (ADR-0009).</summary>
public interface IPlex
{
    Task<PlexPin> CreatePinAsync(string clientId, CancellationToken ct);

    // The account's token once someone approved the pin; null while nobody has.
    Task<string?> CheckPinAsync(string clientId, long pinId, CancellationToken ct);

    Task<string?> UsernameAsync(string clientId, string token, CancellationToken ct);
    Task<IReadOnlyList<PlexServerChoice>> ServersAsync(string clientId, string token, CancellationToken ct);

    // The first of the server's addresses that answers, local ones first.
    Task<string> ConnectAsync(string clientId, PlexServerChoice server, CancellationToken ct);

    Task<IReadOnlyList<PlexSession>> SessionsAsync(PlexConnection server, CancellationToken ct);

    // The libraries of movies, shows and music, each with its newest items.
    Task<IReadOnlyList<PlexLibrary>> LibrariesAsync(PlexConnection server, int recent, CancellationToken ct);

    // Movies, shows, seasons, episodes and albums whose title matches, across one library or all of them, not only the newest.
    Task<IReadOnlyList<PlexItem>> SearchAsync(PlexConnection server, string query, string? libraryId, int limit, CancellationToken ct);

    // The audio and subtitle tracks of an item's first media.
    Task<PlexTracks> TracksAsync(PlexConnection server, string itemId, CancellationToken ct);

    // One item by its id, or null when the server no longer has it.
    Task<PlexItem?> ItemAsync(PlexConnection server, string itemId, CancellationToken ct);

    // A picture from the server, scaled to fit width × height.
    Task<(Stream Content, string ContentType)?> ImageAsync(PlexConnection server, string path, int width, int height, CancellationToken ct);

    // Through the server to the player, which must allow remote control.
    Task ControlAsync(PlexConnection server, string playerId, PlexCommand command, string kind, CancellationToken ct);
}

// plex.tv or the server could not be reached, or refused. The message says what to do about it.
public sealed class PlexException(string message, Exception? inner = null) : Exception(message, inner);
