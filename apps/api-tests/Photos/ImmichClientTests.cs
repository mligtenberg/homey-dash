using System.Net;
using System.Text;
using System.Text.Json;
using HomeyDash.Api.Photos;

namespace HomeyDash.Api.Tests.Photos;

// ImmichClient against a scripted Immich, as Immich 3.2 answers: pages by cursor, after a first page asked by number.
public class ImmichClientTests
{
    private const string AlbumId = "11111111-1111-4111-8111-111111111111";
    private static readonly ImmichAccount Account = new("http://immich.local:2283", "secret-key");

    private sealed class ScriptedImmich(Func<HttpRequestMessage, string?, HttpResponseMessage> answer) : HttpMessageHandler, IHttpClientFactory
    {
        public List<(HttpRequestMessage Request, string? Body)> Requests { get; } = [];

        public HttpClient CreateClient(string name) => new(this, disposeHandler: false);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            Requests.Add((request, body));
            return answer(request, body);
        }
    }

    private static HttpResponseMessage Json(object value, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json") };

    private static object Asset(string id, string type) => new { id, type, fileCreatedAt = "2026-08-12T10:00:00.000Z", isTrashed = false };

    [Fact]
    public async Task AnAlbum_ReadsEveryPageAndLeavesOutVideos()
    {
        var immich = new ScriptedImmich((request, body) =>
            request.RequestUri!.AbsolutePath == $"/api/albums/{AlbumId}" ? Json(new { id = AlbumId, albumName = "Summer", assetCount = 3 })
            : body!.Contains("\"page\":1") ? Json(new { assets = new { items = new[] { Asset("a1", "IMAGE"), Asset("v1", "VIDEO") }, nextCursor = "c2", nextPage = (string?)null } })
            : body.Contains("\"cursor\":\"c2\"") ? Json(new { assets = new { items = new[] { Asset("a2", "IMAGE") }, nextCursor = (string?)null, nextPage = (string?)null } })
            : new HttpResponseMessage(HttpStatusCode.BadRequest));
        var client = new ImmichClient(immich);

        var album = await client.AlbumAsync(Account, AlbumId, CancellationToken.None);

        Assert.NotNull(album);
        Assert.Equal("Summer", album.Name);
        Assert.Equal(["a1", "a2"], album.Photos.Select(p => p.Id));
        Assert.Equal(1, album.SkippedVideos);
        Assert.Equal(new DateTimeOffset(2026, 8, 12, 10, 0, 0, TimeSpan.Zero), album.Photos[0].TakenAt);
        Assert.All(immich.Requests, r => Assert.Equal("secret-key", r.Request.Headers.GetValues("x-api-key").Single()));
        Assert.Contains($"\"albumIds\":[\"{AlbumId}\"]", immich.Requests[1].Body);
    }

    [Fact]
    public async Task OlderImmich_PagesByNumber()
    {
        var immich = new ScriptedImmich((request, body) =>
            request.RequestUri!.AbsolutePath.StartsWith("/api/albums/") ? Json(new { id = AlbumId, albumName = "Summer" })
            : body!.Contains("\"page\":1") ? Json(new { assets = new { items = new[] { Asset("a1", "IMAGE") }, nextPage = "2" } })
            : Json(new { assets = new { items = new[] { Asset("a2", "IMAGE") }, nextPage = (string?)null } }));

        var album = await new ImmichClient(immich).AlbumAsync(Account, AlbumId, CancellationToken.None);

        Assert.Equal(["a1", "a2"], album!.Photos.Select(p => p.Id));
        Assert.Contains("\"page\":2", immich.Requests[2].Body);
    }

    [Fact]
    public async Task AnAlbumImmichDoesNotHave_IsNull()
    {
        var immich = new ScriptedImmich((_, _) => Json(new { message = "Not found" }, HttpStatusCode.NotFound));

        Assert.Null(await new ImmichClient(immich).AlbumAsync(Account, AlbumId, CancellationToken.None));
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "does not accept the API key")]
    [InlineData(HttpStatusCode.Forbidden, "album.read")]
    public async Task ARefusedKey_SaysWhatToDo(HttpStatusCode status, string expected)
    {
        var immich = new ScriptedImmich((_, _) => Json(new { message = "No" }, status));

        var e = await Assert.ThrowsAsync<ImmichException>(() => new ImmichClient(immich).AlbumsAsync(Account, CancellationToken.None));

        Assert.True(e.KeyRefused);
        Assert.Contains(expected, e.Message);
    }

    [Fact]
    public async Task ASelection_SearchesEachWantedPersonByItsQuery_AndLeavesOutTheUnwanted()
    {
        var immich = new ScriptedImmich((request, body) =>
            request.RequestUri!.AbsolutePath == "/api/search/smart" && body!.Contains("\"anna\"")
                ? Json(new { assets = new { items = new[] { Asset("a1", "IMAGE"), Asset("both", "IMAGE"), Asset("v1", "VIDEO") }, nextPage = (string?)null } })
            : request.RequestUri!.AbsolutePath == "/api/search/smart" && body!.Contains("\"cas\"")
                ? Json(new { assets = new { items = new[] { Asset("c1", "IMAGE"), Asset("a1", "IMAGE") }, nextPage = (string?)null } })
            : request.RequestUri!.AbsolutePath == "/api/search/metadata" && body!.Contains("\"bram\"")
                ? Json(new { assets = new { items = new[] { Asset("both", "IMAGE") }, nextPage = (string?)null } })
            : new HttpResponseMessage(HttpStatusCode.BadRequest));
        var selection = new PhotoSelection([new("anna", "Anna"), new("cas", "Cas")], [new("bram", "Bram")], "landscape", 10, 24);

        var photos = await new ImmichClient(immich).SelectAsync(Account, selection, CancellationToken.None);

        Assert.Equal(["a1", "c1"], photos.Select(p => p.Id).Order());
        Assert.All(immich.Requests.Where(r => r.Request.RequestUri!.AbsolutePath == "/api/search/smart"),
            r => Assert.Contains("\"query\":\"landscape\"", r.Body));
    }

    [Fact]
    public async Task ASelectionWithoutPeopleOrQuery_DrawsFromImmichsRandomPhotos()
    {
        var immich = new ScriptedImmich((request, _) => request.RequestUri!.AbsolutePath == "/api/search/random"
            ? Json(Enumerable.Range(1, 8).Select(n => Asset($"r{n}", "IMAGE")).ToArray())
            : new HttpResponseMessage(HttpStatusCode.BadRequest));

        var photos = await new ImmichClient(immich).SelectAsync(Account, new PhotoSelection([], [], null, 3, 0), CancellationToken.None);

        Assert.Equal(3, photos.Count);
        Assert.All(photos, p => Assert.StartsWith("r", p.Id));
    }

    [Fact]
    public async Task AServerThatRefusesThePing_IsNotImmich()
    {
        // Such as Sonarr, which answers 401 to everything without its own key.
        var immich = new ScriptedImmich((_, _) => new HttpResponseMessage(HttpStatusCode.Unauthorized));

        var e = await Assert.ThrowsAsync<ImmichException>(() => new ImmichClient(immich).CheckAsync(Account, CancellationToken.None));

        Assert.False(e.KeyRefused);
        Assert.Contains("not Immich", e.Message);
    }

    [Fact]
    public async Task Immich_IsCheckedWithItsPingAndThenTheKey()
    {
        var immich = new ScriptedImmich((request, _) => request.RequestUri!.AbsolutePath == "/api/server/ping"
            ? Json(new { res = "pong" })
            : Json(new { message = "Invalid API key" }, HttpStatusCode.Unauthorized));

        var e = await Assert.ThrowsAsync<ImmichException>(() => new ImmichClient(immich).CheckAsync(Account, CancellationToken.None));

        Assert.True(e.KeyRefused);
    }

    [Fact]
    public async Task APhoto_IsImmichsPreview()
    {
        var immich = new ScriptedImmich((_, _) =>
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([1, 2, 3]) { Headers = { ContentType = new("image/webp") } } });

        var photo = await new ImmichClient(immich).PhotoAsync(Account, AlbumId, CancellationToken.None);

        Assert.Equal("image/webp", photo!.ContentType);
        Assert.Equal($"http://immich.local:2283/api/assets/{AlbumId}/thumbnail?size=preview", immich.Requests[0].Request.RequestUri!.ToString());
    }
}
