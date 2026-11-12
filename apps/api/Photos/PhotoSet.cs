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

    // The asset ids of photos excluded from it on a display, which no sync brings back, also after another album.
    public IReadOnlyList<string> Excluded { get; set; } = [];

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

    // Leaves the photo out now and at every sync after. False when it is not one of the set's photos.
    public bool Exclude(string photoId)
    {
        if (Excluded.Contains(photoId)) return true;
        if (!Photos.Any(p => p.Id == photoId)) return false;
        Excluded = [.. Excluded, photoId];
        Photos = Photos.Where(p => p.Id != photoId).ToList();
        return true;
    }

    // Lets a sync bring the photo back. False when it was not excluded.
    public bool Restore(string photoId)
    {
        if (!Excluded.Contains(photoId)) return false;
        Excluded = Excluded.Where(id => id != photoId).ToList();
        return true;
    }

    // The photos Immich has for it, but those excluded.
    public List<Photo> Keep(IEnumerable<Photo> photos) => photos.Where(p => !Excluded.Contains(p.Id)).ToList();
}

// Someone Immich recognises by their face. The name is kept so rules read well while Immich is out of reach.
public sealed record PersonRef(string Id, string Name);

/// <summary>
/// Photos drawn at random from Immich: Count of them, showing at least one of With (anyone when empty) and none of
/// Without, matching Query by what is in them when it is set (Immich's smart search, such as "landscape"). The people of
/// With are drawn about evenly, as far as their photos allow. Drawn again every RefreshHours, or only when asked when
/// that is 0.
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

// One photo of a set: Id is its asset id in Immich. TakenAt is when it was taken and Place where, such as "Utrecht,
// Netherlands", as Immich knows them. Faces is null until they are read. Version changes when the photo is edited in
// Immich, such as rotated, so displays fetch it again; null when Immich gives none. OwnerId is the Immich user whose
// photo it is, such as a partner of the account; null when synced before HomeyDash read it.
public sealed record Photo(
    string Id, DateTimeOffset? TakenAt, string? Place = null, Faces? Faces = null, string? Version = null, string? OwnerId = null)
{
    // Not read yet, or read before HomeyDash kept the birth dates of the people on it.
    public bool FacesUnread => Faces is null || Faces is { People.Count: > 0, Born: null };
}

// The faces Immich found in a photo: their middle, which a tile keeps in view when it crops the photo, and the names of
// the people they are, from left to right. Born holds, in the same order, the birth date Immich has of each, such as
// "2021-03-04", or null when it has none; it is null itself until the faces are read again.
public sealed record Faces(Focus Focus, IReadOnlyList<string> People, IReadOnlyList<string?>? Born = null)
{
    public static readonly Faces None = new(Focus.Middle, []);
}

// The middle of the faces in a photo, as fractions of its width and height from the top left; the photo's middle when
// Immich found none.
public sealed record Focus(double X, double Y)
{
    public static readonly Focus Middle = new(.5, .5);
}

/// <summary>The ids of every photo set, so counting missing tiles needs no database.</summary>
public sealed class PhotoSetIndex
{
    private readonly ConcurrentDictionary<Guid, byte> _ids = new();

    public bool Contains(Guid id) => _ids.ContainsKey(id);

    public void Add(Guid id) => _ids.TryAdd(id, 0);

    public void Remove(Guid id) => _ids.TryRemove(id, out _);
}
