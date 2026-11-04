namespace HomeyDash.Api.Photos;

// The Immich section of the configuration.
public sealed class ImmichOptions
{
    // Runs against FakeImmich instead of an Immich server, for development and tests. Never a fallback.
    public bool Fake { get; set; }
}

/// <summary>
/// An Immich account (ADR-0007): where an Immich server is and an API key made in it, with at least the album.read,
/// asset.read, asset.view, face.read and person.read permissions, and asset.edit.get, asset.edit.create and
/// asset.edit.delete to rotate photos from a display. Set up in Management and kept in the database; a home can have
/// several, told apart by their names, such as one per person's Immich. Partners are the Immich users who share their
/// photos with it, as of when Management last looked, with partner.read.
/// </summary>
public sealed record ImmichAccount(string Address, string ApiKey)
{
    public int Id { get; init; }
    public string Name { get; init; } = "Immich";
    public IReadOnlyList<ImmichPartner> Partners { get; init; } = [];

    // The partner's own key at the same Immich, which may edit their photos; null when it has none.
    public ImmichAccount? AsPartner(ImmichPartner partner) => partner.ApiKey is { } key ? this with { ApiKey = key } : null;
}

/// <summary>
/// An Immich user who shares their photos with an account through partner sharing. Only they may edit their photos, so
/// rotating one takes an API key made in their account, with user.read, asset.read and the asset.edit permissions;
/// null until it is given one.
/// </summary>
public sealed record ImmichPartner(string Id, string Name, string? ApiKey = null);

// The Immich accounts in use, oldest first. Only the fake's when the configuration sets Immich:Fake.
public sealed class ImmichAccounts
{
    private volatile IReadOnlyList<ImmichAccount> _all = [];

    public IReadOnlyList<ImmichAccount> All => _all;

    // The oldest, which a new photo set uses unless it names another.
    public ImmichAccount? Default => _all.FirstOrDefault();

    public ImmichAccount? Find(int? id) => id is null ? null : _all.FirstOrDefault(a => a.Id == id);

    public void Set(IEnumerable<ImmichAccount> accounts) => _all = accounts.OrderBy(a => a.Id).ToList();
}

public sealed record ImmichAlbum(string Id, string Name, int AssetCount);

// An album's photos in Immich's order, and how many videos and other assets it holds that a photo set leaves out.
public sealed record ImmichAlbumContents(string Name, IReadOnlyList<Photo> Photos, int SkippedVideos);

// An Immich user, such as a partner.
public sealed record ImmichUser(string Id, string Name);

// Someone with a name in Immich's people.
public sealed record ImmichPerson(string Id, string Name);

public sealed record ImmichPhoto(Stream Content, string ContentType);

// A photo as rotated: its new Photo.Version.
public sealed record RotatedPhoto(string? Version);

/// <summary>
/// What HomeyDash does with Immich (ADR-0008): list albums and people, read one album's photos, draw photos by a
/// selection, find the faces in a photo, fetch a photo, and rotate one; and find whose key it is and who shares with it.
/// </summary>
public interface IImmich
{
    // Checks that Immich answers at the account's address, then that it accepts the key.
    Task CheckAsync(ImmichAccount account, CancellationToken ct);

    // The Immich user the account's key belongs to.
    Task<ImmichUser> UserAsync(ImmichAccount account, CancellationToken ct);

    // The users who share their photos with the account's user.
    Task<IReadOnlyList<ImmichUser>> PartnersAsync(ImmichAccount account, CancellationToken ct);

    Task<IReadOnlyList<ImmichAlbum>> AlbumsAsync(ImmichAccount account, CancellationToken ct);

    // Null when the album is gone, or the account can't see it.
    Task<ImmichAlbumContents?> AlbumAsync(ImmichAccount account, string albumId, CancellationToken ct);

    // The people with a name, by name.
    Task<IReadOnlyList<ImmichPerson>> PeopleAsync(ImmichAccount account, CancellationToken ct);

    // Up to selection.Count photos matching it, at random, one by one as they are drawn.
    IAsyncEnumerable<Photo> DrawAsync(ImmichAccount account, PhotoSelection selection, CancellationToken ct);

    // The faces Immich found in the photo; null when the photo is gone.
    Task<Faces?> FacesAsync(ImmichAccount account, string photoId, CancellationToken ct);

    // Immich's preview of the photo, as edited in Immich: sharp on a tablet, at a fraction of the original's size.
    Task<ImmichPhoto?> PhotoAsync(ImmichAccount account, string photoId, CancellationToken ct);

    // Turns the photo by degrees, clockwise, a multiple of 90, once its preview is turned too. Null when the photo is gone.
    Task<RotatedPhoto?> RotateAsync(ImmichAccount account, string photoId, int degrees, CancellationToken ct);
}

// Immich could not be reached, or refused. The message says what to do about it.
public sealed class ImmichException(string message, bool keyRefused = false, Exception? inner = null) : Exception(message, inner)
{
    public bool KeyRefused { get; } = keyRefused;
}
