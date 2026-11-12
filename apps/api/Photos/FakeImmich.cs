using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Text;

namespace HomeyDash.Api.Photos;

/// <summary>
/// An Immich that needs no Immich server, used when the configuration sets Immich:Fake. It has two albums: Summer, with
/// 12 photos and a video, and Garden, with 3 photos. Anna is on the even Summer photos, Bram on every third, and Cas on
/// the Garden photos. A selection ignores its query. Photos are soft gradients with a number, drawn as SVG; one with
/// someone on it has a white disc for a face, near the top, on the left of even photos and the right of odd ones. A
/// rotated photo is drawn, and its face found, turned; its Version is how far it is turned. Its user shares Daan's
/// photos, of which the last Garden photo is one; any key but its own is Daan's.
/// </summary>
public sealed class FakeImmich(TimeProvider time, ImmichOptions? options = null) : IImmich
{
    private static readonly HttpClient Picsum = new() { Timeout = TimeSpan.FromSeconds(10) };

    public static readonly ImmichAccount Account = new("http://fake-immich", "fake") { Id = 1, Name = "Fake Immich" };

    public const string SummerId = "00000000-0000-4000-8000-000000000001";
    public const string GardenId = "00000000-0000-4000-8000-000000000002";
    public const int SummerPhotos = 12;

    // How far each rotated photo is turned clockwise, in degrees.
    private readonly ConcurrentDictionary<string, int> _turned = new();

    private static readonly (string Id, string Name, int Photos, int Videos)[] Albums =
        [(SummerId, "Summer", SummerPhotos, 1), (GardenId, "Garden", 3, 0)];

    public Task CheckAsync(ImmichAccount account, CancellationToken ct) => Task.CompletedTask;

    public static readonly ImmichUser User = new("00000000-0000-4000-a000-000000000001", "Fake");
    public static readonly ImmichUser Daan = new("00000000-0000-4000-a000-000000000002", "Daan");

    public Task<ImmichUser> UserAsync(ImmichAccount account, CancellationToken ct) =>
        Task.FromResult(account.ApiKey == Account.ApiKey ? User : Daan);

    public Task<IReadOnlyList<ImmichUser>> PartnersAsync(ImmichAccount account, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<ImmichUser>>([Daan]);

    public const string AnnaId = "00000000-0000-4000-9000-00000000000a";
    public const string BramId = "00000000-0000-4000-9000-00000000000b";
    public const string CasId = "00000000-0000-4000-9000-00000000000c";

    public Task<IReadOnlyList<ImmichPerson>> PeopleAsync(ImmichAccount account, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<ImmichPerson>>([new(AnnaId, "Anna"), new(BramId, "Bram"), new(CasId, "Cas")]);

    public async IAsyncEnumerable<Photo> DrawAsync(
        ImmichAccount account, PhotoSelection selection, [EnumeratorCancellation] CancellationToken ct)
    {
        List<(Photo Photo, string[] People)> library = [];
        foreach (var (id, _, _, _) in Albums)
        {
            var photos = (await AlbumAsync(account, id, ct))!.Photos;
            library.AddRange(photos.Select((photo, i) => (photo, People(id, i + 1))));
        }
        foreach (var (photo, _) in library
            .Where(p => selection.With.Count == 0 || selection.With.Any(w => p.People.Contains(w.Id)))
            .Where(p => !selection.Without.Any(w => p.People.Contains(w.Id)))
            .Take(selection.Count))
        {
            await Task.Yield();
            yield return photo;
        }
    }

    // Summer is at the sea, but for every fourth photo, which has no place; Garden is at home.
    private static string? Place(string albumId, int n) =>
        albumId == GardenId ? "Utrecht, Netherlands" : n % 4 == 0 ? null : "Scheveningen, Netherlands";

    private static string[] People(string albumId, int n) =>
        albumId == GardenId ? [CasId] : [.. n % 2 == 0 ? [AnnaId] : Array.Empty<string>(), .. n % 3 == 0 ? [BramId] : Array.Empty<string>()];

    public Task<IReadOnlyList<ImmichAlbum>> AlbumsAsync(ImmichAccount account, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<ImmichAlbum>>(Albums.Select(a => new ImmichAlbum(a.Id, a.Name, a.Photos + a.Videos)).ToList());

    public Task<ImmichAlbumContents?> AlbumAsync(ImmichAccount account, string albumId, CancellationToken ct)
    {
        var album = Albums.FirstOrDefault(a => a.Id == albumId);
        if (album.Id is null) return Task.FromResult<ImmichAlbumContents?>(null);
        var start = time.GetUtcNow().AddDays(-album.Photos);
        var photos = Enumerable.Range(1, album.Photos)
            .Select(n => $"{album.Id[..^4]}{album.Id[^2..]}{n:x2}")
            .Select((id, i) => new Photo(id, start.AddDays(i + 1), Place(album.Id, i + 1), Version: Version(id),
                OwnerId: album.Id == GardenId && i + 1 == album.Photos ? Daan.Id : User.Id)).ToList();
        return Task.FromResult<ImmichAlbumContents?>(new ImmichAlbumContents(album.Name, photos, album.Videos));
    }

    public Task<Faces?> FacesAsync(ImmichAccount account, string photoId, CancellationToken ct)
    {
        if (Album(photoId) is not { } album || Number(photoId) is not { } n) return Task.FromResult<Faces?>(null);
        var people = People(album, n).Select(id => Names[id]).ToList();
        return Task.FromResult<Faces?>(Face(photoId) is { } focus ? new Faces(Turn(focus, Turned(photoId)), people, people.Select(name => name == "Anna" ? "2019-05-10" : (string?)null).ToList()) : Faces.None);
    }

    public Task<RotatedPhoto?> RotateAsync(ImmichAccount account, string photoId, int degrees, CancellationToken ct)
    {
        if (Number(photoId) is null) return Task.FromResult<RotatedPhoto?>(null);
        _turned[photoId] = ((Turned(photoId) + degrees) % 360 + 360) % 360;
        return Task.FromResult<RotatedPhoto?>(new(Version(photoId)));
    }

    // Daan's photos belong to Daan's account, so the fake's own key can't favorite them.
    public Task FavoriteAsync(ImmichAccount account, string photoId, bool favorite, CancellationToken ct) =>
        Number(photoId) is null ? Task.FromException(new ImmichException("That is not a photo in Immich."))
        : Task.CompletedTask;

    private int Turned(string photoId) => _turned.GetValueOrDefault(photoId);

    private string? Version(string photoId) => Turned(photoId) is var turned and not 0 ? $"turned-{turned}" : null;

    // A quarter turn clockwise takes the top left to the top right.
    private static Focus Turn(Focus focus, int degrees) =>
        degrees <= 0 ? focus : Turn(new Focus(Math.Round(1 - focus.Y, 3), focus.X), degrees - 90);

    private static readonly Dictionary<string, string> Names = new() { [AnnaId] = "Anna", [BramId] = "Bram", [CasId] = "Cas" };

    private static string? Album(string photoId) =>
        photoId.Length >= 4 ? Albums.FirstOrDefault(a => a.Id[^2..] == photoId[^4..^2]).Id : null;

    // The photo's number is the last two hex digits of its id, after its album's last two.
    private static int? Number(string photoId) =>
        photoId.Length >= 4 && int.TryParse(photoId[^2..], System.Globalization.NumberStyles.HexNumber, null, out var n) ? n : null;

    private static Focus? Face(string photoId)
    {
        if (Number(photoId) is not { } n || Album(photoId) is not { } album) return null;
        return People(album, n).Length == 0 ? null : new Focus(n % 2 == 0 ? .2 : .8, .15);
    }

    public async Task<ImmichPhoto?> PhotoAsync(ImmichAccount account, string photoId, CancellationToken ct)
    {
        if (Number(photoId) is not { } n) return null;
        var (width, height) = (n % 3) switch { 0 => (1600, 1200), 1 => (1200, 1600), _ => (1920, 1080) };
        var hue = n * 360 / SummerPhotos;
        var turned = Turned(photoId);
        var (outerWidth, outerHeight) = turned is 90 or 270 ? (height, width) : (width, height);
        var turn = turned switch { 90 => $"translate({height},0) rotate(90)", 180 => $"translate({width},{height}) rotate(180)", 270 => $"translate(0,{width}) rotate(270)", _ => "" };
        if (options?.Picsum == true && await PicsumAsync(photoId, outerWidth, outerHeight, ct) is { } picture) return picture;
        var svg = $"""
            <svg xmlns="http://www.w3.org/2000/svg" width="{outerWidth}" height="{outerHeight}" viewBox="0 0 {outerWidth} {outerHeight}">
              <g transform="{turn}">
              <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="hsl({hue},70%,62%)"/><stop offset="1" stop-color="hsl({(hue + 60) % 360},65%,38%)"/>
              </linearGradient></defs>
              <rect width="{width}" height="{height}" fill="url(#g)"/>
              <text x="{width / 2}" y="{height / 2}" fill="#fff" fill-opacity="0.85" font-family="sans-serif" font-size="{Math.Min(width, height) / 4}"
                text-anchor="middle" dominant-baseline="central">{n}</text>
              {(Face(photoId) is { } face ? $"<circle cx=\"{face.X * width}\" cy=\"{face.Y * height}\" r=\"{Math.Min(width, height) / 10}\" fill=\"#fff\"/>" : "")}
              </g>
            </svg>
            """;
        return new ImmichPhoto(new MemoryStream(Encoding.UTF8.GetBytes(svg)), "image/svg+xml");
    }

    // A real picture, the same one every time for a photo.
    private static async Task<ImmichPhoto?> PicsumAsync(string photoId, int width, int height, CancellationToken ct)
    {
        try
        {
            var bytes = await Picsum.GetByteArrayAsync($"https://picsum.photos/seed/{photoId[^4..]}/{width}/{height}.jpg", ct);
            return new ImmichPhoto(new MemoryStream(bytes), "image/jpeg");
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return null; }
    }
}
