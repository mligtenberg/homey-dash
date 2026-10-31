using System.Text;

namespace HomeyDash.Api.Photos;

/// <summary>
/// An Immich that needs no Immich server, used when the configuration sets Immich:Fake. It has two albums: Summer, with
/// 12 photos and a video, and Garden, with 3 photos. Anna is on the even Summer photos, Bram on every third, and Cas on
/// the Garden photos. A selection ignores its query. Photos are soft gradients with a number, drawn as SVG.
/// </summary>
public sealed class FakeImmich(TimeProvider time) : IImmich
{
    public static readonly ImmichAccount Account = new("http://fake-immich", "fake") { Id = 1, Name = "Fake Immich" };

    public const string SummerId = "00000000-0000-4000-8000-000000000001";
    public const string GardenId = "00000000-0000-4000-8000-000000000002";
    public const int SummerPhotos = 12;

    private static readonly (string Id, string Name, int Photos, int Videos)[] Albums =
        [(SummerId, "Summer", SummerPhotos, 1), (GardenId, "Garden", 3, 0)];

    public Task CheckAsync(ImmichAccount account, CancellationToken ct) => Task.CompletedTask;

    public const string AnnaId = "00000000-0000-4000-9000-00000000000a";
    public const string BramId = "00000000-0000-4000-9000-00000000000b";
    public const string CasId = "00000000-0000-4000-9000-00000000000c";

    public Task<IReadOnlyList<ImmichPerson>> PeopleAsync(ImmichAccount account, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<ImmichPerson>>([new(AnnaId, "Anna"), new(BramId, "Bram"), new(CasId, "Cas")]);

    public async Task<IReadOnlyList<Photo>> SelectAsync(ImmichAccount account, PhotoSelection selection, CancellationToken ct)
    {
        List<(Photo Photo, string[] People)> library = [];
        foreach (var (id, _, _, _) in Albums)
        {
            var photos = (await AlbumAsync(account, id, ct))!.Photos;
            library.AddRange(photos.Select((photo, i) => (photo, People(id, i + 1))));
        }
        return library
            .Where(p => selection.With.Count == 0 || selection.With.Any(w => p.People.Contains(w.Id)))
            .Where(p => !selection.Without.Any(w => p.People.Contains(w.Id)))
            .Select(p => p.Photo)
            .Take(selection.Count)
            .ToList();
    }

    private static string[] People(string albumId, int n) =>
        albumId == GardenId ? [CasId] : [.. n % 2 == 0 ? [AnnaId] : Array.Empty<string>(), .. n % 3 == 0 ? [BramId] : Array.Empty<string>()];

    public Task<IReadOnlyList<ImmichAlbum>> AlbumsAsync(ImmichAccount account, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<ImmichAlbum>>(Albums.Select(a => new ImmichAlbum(a.Id, a.Name, a.Photos + a.Videos)).ToList());

    public Task<ImmichAlbumContents?> AlbumAsync(ImmichAccount account, string albumId, CancellationToken ct)
    {
        var album = Albums.FirstOrDefault(a => a.Id == albumId);
        if (album.Id is null) return Task.FromResult<ImmichAlbumContents?>(null);
        var start = time.GetUtcNow().AddDays(-album.Photos);
        var photos = Enumerable.Range(1, album.Photos).Select(n => new Photo($"{album.Id[..^4]}{album.Id[^2..]}{n:x2}", start.AddDays(n))).ToList();
        return Task.FromResult<ImmichAlbumContents?>(new ImmichAlbumContents(album.Name, photos, album.Videos));
    }

    // The photo's number is the last two hex digits of its id.
    public Task<ImmichPhoto?> PhotoAsync(ImmichAccount account, string photoId, CancellationToken ct)
    {
        if (photoId.Length < 2 || !int.TryParse(photoId[^2..], System.Globalization.NumberStyles.HexNumber, null, out var n))
            return Task.FromResult<ImmichPhoto?>(null);
        var (width, height) = (n % 3) switch { 0 => (1600, 1200), 1 => (1200, 1600), _ => (1920, 1080) };
        var hue = n * 360 / SummerPhotos;
        var svg = $"""
            <svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
              <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="hsl({hue},70%,62%)"/><stop offset="1" stop-color="hsl({(hue + 60) % 360},65%,38%)"/>
              </linearGradient></defs>
              <rect width="100%" height="100%" fill="url(#g)"/>
              <text x="50%" y="50%" fill="#fff" fill-opacity="0.85" font-family="sans-serif" font-size="{Math.Min(width, height) / 4}"
                text-anchor="middle" dominant-baseline="central">{n}</text>
            </svg>
            """;
        return Task.FromResult<ImmichPhoto?>(new ImmichPhoto(new MemoryStream(Encoding.UTF8.GetBytes(svg)), "image/svg+xml"));
    }
}
