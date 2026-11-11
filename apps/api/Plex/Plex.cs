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
    // The Plex Home profile the server is used as, so what is watched and resumed is that profile's; null is the profile that signed in.
    // Token stays the signed-in one, which is what switches profiles.
    public string? ProfileId { get; init; }
    public string? ProfileName { get; init; }

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

// A profile of the Plex Home: Admin owns it, Protected asks for a PIN before it is used.
public sealed record PlexProfile(string Id, string Name, bool Admin, bool Protected);

// The profiles to choose between, and the one in use.
public sealed record PlexProfileList(IReadOnlyList<PlexProfile> Profiles, string? CurrentId);

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

// Something in a library: a movie, show, season, episode, album or track. AddedAt is when it was added (the epoch when unknown).
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
    // The actors, in billing order, with the part each plays.
    public IReadOnlyList<PlexActor> Cast { get; init; } = [];
    // The wide artwork behind it.
    public string? Art { get; init; }
    // A film or episode that was played, or a season or series whose episodes all were, for this Plex account.
    public bool Watched { get; init; }
    // An episode's, a season's or a track's number within its season or album; only on what ChildrenAsync lists.
    public int? Index { get; init; }
}

// An actor of a film or show: Image is a picture path or Plex's own https://metadata-static.plex.tv one, for /api/plex/image.
// Id is the server's tag for the person, which finds their other work on it; Key is plex.tv's, which finds their biography.
public sealed record PlexActor(string Name, string? Role, string? Image, string? Id = null, string? Key = null);

// A person from the cast and what the server holds of their work: Bio, Born ("10 March 1992 (34 years)"), Died ("11 August 2014 (aged 63)"), Place of birth and Roles ("Actor, Producer") are plex.tv's, when it knows them; Works are the films and
// series on this server they appear in, newest first.
public sealed record PlexPerson(string Name, string? Image, string? Bio, string? Born, string? Died, string? Place, string? Roles, IReadOnlyList<PlexItem> Works);

// An audio or subtitle track of an item. Label says language, format and channels (English (AC3 5.1)); Selected is the one
// Plex plays when asked for none in particular.
public sealed record PlexTrack(string Id, string Label, bool Selected);

/// <summary>
/// A track's file, a show's theme or a video stream as the server serves it, for a screen to play: Status is 200 or, for a range that was asked
/// for, 206 with ContentRange.
/// </summary>
public sealed record PlexAudio(Stream Content, string ContentType, int Status, long? Length, string? ContentRange);

public sealed record PlexTracks(IReadOnlyList<PlexTrack> Audio, IReadOnlyList<PlexTrack> Subtitles);

public sealed record PlexLibrary(string Id, string Title, string Type, IReadOnlyList<PlexItem> Recent)
{
    // How many films, series or albums the library holds.
    public int Count { get; init; }
    // The newest of them, newest first: films, series or albums, where Recent has what the server lists as newly added, which for
    // a library of series is its episodes.
    public IReadOnlyList<PlexItem> Titles { get; init; } = [];
}

// A page of a library: Total is how many it holds in all.
public sealed record PlexPage(IReadOnlyList<PlexItem> Items, int Total);

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

    // The profiles of the Plex Home the token belongs to; none when it is no home's.
    Task<IReadOnlyList<PlexProfile>> ProfilesAsync(string clientId, string token, CancellationToken ct);

    // The token of a profile, for what it watches to be its own. A profile with a PIN needs it; a wrong one is a PlexException.
    Task<string> SwitchProfileAsync(string clientId, string token, string profileId, string? pin, CancellationToken ct);

    // The libraries of movies, shows and music, each with its newest items.
    Task<IReadOnlyList<PlexLibrary>> LibrariesAsync(PlexConnection server, int recent, CancellationToken ct);

    // One page of what a library holds, alphabetically: films, series, or albums (an artist library lists its albums), never the
    // episodes, seasons or tracks under them. libraryType is the library's type (movie, show or artist).
    Task<PlexPage> LibraryItemsAsync(PlexConnection server, string libraryId, string libraryType, int start, int size, CancellationToken ct);

    // Movies, shows, albums, and episodes and tracks whose own title matches (never because their show or album does), across
    // one library or all of them, not only the newest.
    Task<IReadOnlyList<PlexItem>> SearchAsync(PlexConnection server, string query, string? libraryId, int limit, CancellationToken ct);

    // What is under an item, in order: a show's seasons, a season's episodes, an album's tracks. Nothing for anything else.
    Task<IReadOnlyList<PlexItem>> ChildrenAsync(PlexConnection server, string itemId, CancellationToken ct);

    // The audio and subtitle tracks of an item's first media.
    Task<PlexTracks> TracksAsync(PlexConnection server, string itemId, CancellationToken ct);

    // A person from an item's cast: their biography (when plex.tv has one) and the films and series of the server they are in.
    Task<PlexPerson> PersonAsync(PlexConnection server, PlexActor actor, CancellationToken ct);

    // One item by its id, or null when the server no longer has it.
    Task<PlexItem?> ItemAsync(PlexConnection server, string itemId, CancellationToken ct);

    // A track's own file, or a show's theme song, from the server; range is the Range header of the request that wants it. Null when
    // there is none (a show without a theme, an item that is no track).
    Task<PlexAudio?> AudioAsync(PlexConnection server, string itemId, bool theme, string? range, CancellationToken ct);

    // Tells the server where a player is in an item, as a Plex client does: that is how it keeps what was watched and where to resume.
    // state is playing, paused or stopped; a stop near the end counts the item as watched.
    Task ReportAsync(PlexConnection server, string itemId, string state, long timeMs, long durationMs, CancellationToken ct);

    // A movie or episode as one fragmented mp4 stream the server makes of whatever the file holds, for a browser to play. Null when the
    // server has no such item. It can't be skipped through: a Range request is not passed on.
    Task<PlexAudio?> VideoAsync(PlexConnection server, string itemId, CancellationToken ct);

    // A picture from the server, scaled to fit width × height.
    Task<(Stream Content, string ContentType)?> ImageAsync(PlexConnection server, string path, int width, int height, CancellationToken ct);

    // Through the server to the player, which must allow remote control.
    Task ControlAsync(PlexConnection server, string playerId, PlexCommand command, string kind, CancellationToken ct);
}

public static class PlexSearch
{
    /// <summary>
    /// Whether a title answers a search: every word of the query is in it, whatever the case or accents. Plex also finds an
    /// episode by its show and a track by its album; a title does not say that, so those are left out.
    /// </summary>
    public static bool Matches(string title, string query)
    {
        var plain = Fold(title);
        return Fold(query).Split(' ', StringSplitOptions.RemoveEmptyEntries).All(plain.Contains);
    }

    private static string Fold(string text) =>
        new string(text.Normalize(System.Text.NormalizationForm.FormD)
            .Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark)
            .ToArray()).ToLowerInvariant();
}

// plex.tv or the server could not be reached, or refused. The message says what to do about it.
public class PlexException(string message, Exception? inner = null) : Exception(message, inner);

// The server knows who is asking and says they may not: a profile that isn't the owner can't see what plays for others.
public sealed class PlexForbiddenException(string message) : PlexException(message);
