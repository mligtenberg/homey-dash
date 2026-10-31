using System.Collections.Concurrent;

namespace HomeyDash.Api.Photos;

/// <summary>
/// A named photo set (ADR-0008) that follows an Immich album, or draws photos at random from Immich by a
/// <see cref="PhotoSelection"/>. HomeyDash keeps the list of its photos, synced from Immich, and fetches each photo
/// from Immich when a display shows it. A photo tile's target is <see cref="Target"/>.
/// </summary>
public sealed class PhotoSet
{
    public const int MaxNameLength = 100;
    private const string TargetPrefix = "photo-set:";

    public Guid Id { get; init; } = Guid.NewGuid();
    public required string Name { get; set; }

    // The Immich account it draws from. Null once that account is removed, until it is given another.
    public int? AccountId { get; set; }

    // The Immich album it follows, and that album's name when it last synced. Null for a selection.
    public string? AlbumId { get; set; }
    public string AlbumName { get; set; } = "";

    // What it draws from Immich instead of an album. Stored as one JSON document.
    public PhotoSelection? Selection { get; set; }

    // In the album's order, or as drawn, as of the last sync. Stored as one JSON document, like a dashboard's layout.
    public IReadOnlyList<Photo> Photos { get; set; } = [];
    public DateTimeOffset? SyncedAt { get; set; }

    // Videos and other assets in the album, which a photo set leaves out.
    public int SkippedVideos { get; set; }

    // Prefixed, since Homey's device ids are GUIDs too.
    public string Target => TargetPrefix + Id;

    public static bool TryParseTarget(string target, out Guid id)
    {
        id = Guid.Empty;
        return target.StartsWith(TargetPrefix, StringComparison.Ordinal) && Guid.TryParse(target.AsSpan(TargetPrefix.Length), out id);
    }

    public static string? ValidateName(string? name) =>
        string.IsNullOrWhiteSpace(name) ? "Give the photo set a name."
        : name.Trim().Length > MaxNameLength ? $"Keep the name to {MaxNameLength} characters."
        : null;
}

// Someone Immich recognises by their face. The name is kept so rules read well while Immich is out of reach.
public sealed record PersonRef(string Id, string Name);

/// <summary>
/// Photos drawn at random from Immich: Count of them, showing at least one of With (anyone when empty) and none of
/// Without, matching Query by what is in them when it is set (Immich's smart search, such as "landscape"). Drawn
/// again every RefreshHours, or only when asked when that is 0.
/// </summary>
public sealed record PhotoSelection(IReadOnlyList<PersonRef> With, IReadOnlyList<PersonRef> Without, string? Query, int Count, int RefreshHours)
{
    public const int MaxCount = 1000;
    public const int MaxQueryLength = 200;
    public const int DefaultCount = 100;
    public static readonly int[] RefreshChoices = [0, 1, 6, 24, 168];

    public static string? Validate(PhotoSelection selection) =>
        selection.Count is < 1 or > MaxCount ? $"Draw between 1 and {MaxCount} photos."
        : !RefreshChoices.Contains(selection.RefreshHours) ? "Choose how often to draw again."
        : selection.Query?.Trim().Length > MaxQueryLength ? $"Keep the search to {MaxQueryLength} characters."
        : selection.With.Concat(selection.Without).Any(p => string.IsNullOrWhiteSpace(p.Id)) ? "Choose people from Immich."
        : selection.With.Any(p => selection.Without.Any(o => o.Id == p.Id)) ? "Someone can't be both in and out of the photos."
        : null;

    public PhotoSelection Normalized() => this with { Query = string.IsNullOrWhiteSpace(Query) ? null : Query.Trim() };

    // Whether the periodic sync draws again: never drawn, or drawn RefreshHours ago.
    public bool Due(DateTimeOffset? drawnAt, DateTimeOffset now) =>
        drawnAt is null || RefreshHours > 0 && now >= drawnAt.Value.AddHours(RefreshHours);
}

// One photo of a set: Id is its asset id in Immich. TakenAt is when it was taken, as Immich knows it.
public sealed record Photo(string Id, DateTimeOffset? TakenAt);

/// <summary>The ids of every photo set, so counting missing tiles needs no database.</summary>
public sealed class PhotoSetIndex
{
    private readonly ConcurrentDictionary<Guid, byte> _ids = new();

    public bool Contains(Guid id) => _ids.ContainsKey(id);

    public void Add(Guid id) => _ids.TryAdd(id, 0);

    public void Remove(Guid id) => _ids.TryRemove(id, out _);
}
