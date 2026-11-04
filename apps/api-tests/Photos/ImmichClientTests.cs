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

    private static object Asset(string id, string type, object? exifInfo = null) =>
        new { id, type, fileCreatedAt = "2026-08-12T10:00:00.000Z", isTrashed = false, exifInfo };

    [Fact]
    public async Task AnAlbum_ReadsEveryPageAndLeavesOutVideos()
    {
        var immich = new ScriptedImmich((request, body) =>
            request.RequestUri!.AbsolutePath == $"/api/albums/{AlbumId}" ? Json(new { id = AlbumId, albumName = "Summer", assetCount = 3 })
            : body!.Contains("\"page\":1") ? Json(new { assets = new { items = new[] { Asset("a1", "IMAGE"), Asset("v1", "VIDEO") }, nextCursor = "c2", nextPage = (string?)null } })
            : body.Contains("\"cursor\":\"c2\"") ? Json(new { assets = new { items = new[] { Asset("a2", "IMAGE", new { city = (string?)null, state = "Zeeland", country = "Netherlands" }) }, nextCursor = (string?)null, nextPage = (string?)null } })
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
        Assert.Contains("\"withExif\":true", immich.Requests[1].Body);
        // Without a city, the state stands in.
        Assert.Null(album.Photos[0].Place);
        Assert.Equal("Zeeland, Netherlands", album.Photos[1].Place);
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
    public async Task Partners_AreThoseWhoShareWithTheAccount_ByName_AndAPhotoSaysWhoseItIs()
    {
        var immich = new ScriptedImmich((request, body) => request.RequestUri!.PathAndQuery switch
        {
            "/api/partners?direction=shared-with" => Json(new[] { new { id = "u3", name = "Zoë", email = "zoe@x" }, new { id = "u2", name = "", email = "daan@x" } }),
            "/api/users/me" => Json(new { id = "u1", name = "Anna", email = "anna@x" }),
            $"/api/albums/{AlbumId}" => Json(new { id = AlbumId, albumName = "Summer" }),
            _ => Json(new { assets = new { items = new[] { new { id = "a1", type = "IMAGE", ownerId = "u2" } }, nextPage = (string?)null } }),
        });
        var client = new ImmichClient(immich);

        // Without a name, by email.
        Assert.Equal([new ImmichUser("u2", "daan@x"), new ImmichUser("u3", "Zoë")], await client.PartnersAsync(Account, CancellationToken.None));
        Assert.Equal(new ImmichUser("u1", "Anna"), await client.UserAsync(Account, CancellationToken.None));
        Assert.Equal("u2", (await client.AlbumAsync(Account, AlbumId, CancellationToken.None))!.Photos[0].OwnerId);
    }

    [Fact]
    public async Task AKeyThatMayNotSeePartners_SaysWhichPermissionItLacks()
    {
        var immich = new ScriptedImmich((_, _) => Json(new { message = "Missing required permission" }, HttpStatusCode.Forbidden));

        var e = await Assert.ThrowsAsync<ImmichException>(() => new ImmichClient(immich).PartnersAsync(Account, CancellationToken.None));
        Assert.Contains("partner.read", e.Message);
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

        var photos = await new ImmichClient(immich).DrawAsync(Account, selection, CancellationToken.None).ToListAsync();

        Assert.Equal(["a1", "c1"], photos.Select(p => p.Id).Order());
        Assert.All(immich.Requests.Where(r => r.Request.RequestUri!.AbsolutePath == "/api/search/smart"),
            r => Assert.Contains("\"query\":\"landscape\"", r.Body));
    }

    private static object Of(string id, params string[] people) =>
        new { id, type = "IMAGE", fileCreatedAt = "2026-08-12T10:00:00.000Z", isTrashed = false, people = people.Select(p => new { id = p }) };

    [Fact]
    public async Task ASelection_DrawsWantedPeopleEvenly_ABatchAtATime_CountingAPhotoForEveryoneOnIt()
    {
        // Anna is on 50 photos, and on "ab" with Bram, who has 3 more; Cas is on 4, one with Dirk, who is unwanted.
        object[] annas = [.. Enumerable.Range(1, 50).Select(i => Of($"a{i}", "anna")), Of("ab", "anna", "bram")];
        object[] brams = [Of("ab", "anna", "bram"), .. Enumerable.Range(1, 3).Select(i => Of($"b{i}", "bram"))];
        object[] cases = [.. Enumerable.Range(1, 4).Select(i => Of($"c{i}", "cas")), Of("cd", "cas", "dirk")];
        var immich = new ScriptedImmich((request, body) => request.RequestUri!.AbsolutePath != "/api/search/random"
            ? new HttpResponseMessage(HttpStatusCode.BadRequest)
            : Json(body!.Contains("\"anna\"") ? annas.Take(JsonDocument.Parse(body).RootElement.GetProperty("size").GetInt32())
                : body.Contains("\"bram\"") ? brams : cases));
        var selection = new PhotoSelection([new("anna", "Anna"), new("bram", "Bram"), new("cas", "Cas")], [new("dirk", "Dirk")], null, 12, 24);

        var photos = await new ImmichClient(immich).DrawAsync(Account, selection, CancellationToken.None).ToListAsync();

        // Bram is on 4 photos and Cas on 4 without Dirk; Anna's fill up the rest, with "ab" counting for her too.
        var ids = photos.Select(p => p.Id).ToList();
        Assert.Equal(12, ids.Count);
        Assert.Equal(["ab", "b1", "b2", "b3", "c1", "c2", "c3", "c4"], ids.Where(id => !id.StartsWith('a') || id == "ab").Order());
        Assert.Equal(4, ids.Count(id => id.StartsWith('a') && id != "ab"));
        Assert.All(immich.Requests, r => Assert.Contains("\"withPeople\":true", r.Body));
        // Anna's photos came a batch at a time, not all at once.
        Assert.All(immich.Requests.Where(r => r.Body!.Contains("\"anna\"")), r => Assert.Contains("\"size\":50", r.Body));
    }

    [Fact]
    public async Task ASelectionWithoutPeopleOrQuery_DrawsFromImmichsRandomPhotos()
    {
        var immich = new ScriptedImmich((request, _) => request.RequestUri!.AbsolutePath == "/api/search/random"
            ? Json(Enumerable.Range(1, 8).Select(n => Asset($"r{n}", "IMAGE")).ToArray())
            : new HttpResponseMessage(HttpStatusCode.BadRequest));

        var photos = await new ImmichClient(immich).DrawAsync(Account, new PhotoSelection([], [], null, 3, 0), CancellationToken.None).ToListAsync();

        Assert.Equal(3, photos.Count);
        Assert.All(photos, p => Assert.StartsWith("r", p.Id));
    }

    private const string PhotoId = "22222222-2222-4222-8222-222222222222";

    private static object Face(int x1, int y1, int x2, int y2, object? person = null) =>
        new { boundingBoxX1 = x1, boundingBoxY1 = y1, boundingBoxX2 = x2, boundingBoxY2 = y2, imageWidth = 2000, imageHeight = 1000, person };

    [Fact]
    public async Task APhotosFaces_AreFocusedOnTheirMiddle_AndNamedLeftToRight()
    {
        var immich = new ScriptedImmich((request, _) => request.RequestUri!.PathAndQuery == $"/api/faces?id={PhotoId}"
            ? Json(new[]
            {
                Face(1000, 200, 1200, 500, new { name = "Bram", isHidden = false }),
                Face(200, 100, 400, 300, new { name = "Anna", isHidden = false }),
                Face(600, 100, 700, 200, new { name = "", isHidden = false }),
                Face(700, 100, 800, 200, new { name = "Stranger", isHidden = true }),
                Face(800, 100, 900, 200),
            })
            : new HttpResponseMessage(HttpStatusCode.BadRequest));

        var faces = await new ImmichClient(immich).FacesAsync(Account, PhotoId, CancellationToken.None);

        Assert.NotNull(faces);
        Assert.Equal(new Focus(.35, .3), faces.Focus);
        Assert.Equal(["Anna", "Bram"], faces.People);
    }

    [Fact]
    public async Task APhotoWithoutFaces_IsFocusedOnItsMiddle_AndAKeyWithoutFaceRead_IsRefused()
    {
        var none = new ScriptedImmich((_, _) => Json(Array.Empty<object>()));
        Assert.Equal(Faces.None, await new ImmichClient(none).FacesAsync(Account, PhotoId, CancellationToken.None));

        var refused = new ScriptedImmich((_, _) => Json(new { message = "Missing required permission: face.read" }, HttpStatusCode.Forbidden));
        var e = await Assert.ThrowsAsync<ImmichException>(() => new ImmichClient(refused).FacesAsync(Account, PhotoId, CancellationToken.None));
        Assert.True(e.KeyRefused);
        Assert.Contains("face.read", e.Message);
    }

    // Answers the asset with its thumbhash before an edit, and the turned preview's after; the edits as given. Refuses
    // edits with refusal, when given.
    private static ScriptedImmich Editable(object[] edits, HttpStatusCode? refusal = null)
    {
        var edited = false;
        return new ScriptedImmich((request, _) =>
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path == $"/api/assets/{PhotoId}") return Json(new { id = PhotoId, thumbhash = edited ? "turned" : "upright" });
            if (path != $"/api/assets/{PhotoId}/edits") return new HttpResponseMessage(HttpStatusCode.BadRequest);
            if (request.Method == HttpMethod.Get) return Json(new { assetId = PhotoId, edits });
            if (refusal is { } status) return Json(new { message = "Editing live photos is not supported", statusCode = (int)status }, status);
            edited = true;
            return request.Method == HttpMethod.Delete ? new HttpResponseMessage(HttpStatusCode.NoContent) : Json(new { assetId = PhotoId, edits });
        });
    }

    private static object Edit(string action, object parameters) => new { id = Guid.NewGuid(), action, parameters };

    [Fact]
    public async Task Rotating_TurnsTheLastRotationFurther_AndWaitsForTheTurnedPreview()
    {
        var immich = Editable([Edit("crop", new { x = 0, y = 0, width = 100, height = 50 }), Edit("rotate", new { angle = 90 })]);

        var rotated = await new ImmichClient(immich).RotateAsync(Account, PhotoId, 90, CancellationToken.None);

        Assert.Equal(new RotatedPhoto("turned"), rotated);
        Assert.Equal(
            """{"edits":[{"action":"crop","parameters":{"x":0,"y":0,"width":100,"height":50}},{"action":"rotate","parameters":{"angle":180}}]}""",
            immich.Requests.Single(r => r.Request.Method == HttpMethod.Put).Body);
    }

    [Fact]
    public async Task Rotating_AddsARotationAfterOtherEdits_AndAFullTurnTakesTheEditsOut()
    {
        var mirrored = Editable([Edit("mirror", new { axis = "horizontal" })]);
        await new ImmichClient(mirrored).RotateAsync(Account, PhotoId, -90, CancellationToken.None);
        Assert.Contains("""{"action":"mirror","parameters":{"axis":"horizontal"}},{"action":"rotate","parameters":{"angle":270}}""",
            mirrored.Requests.Single(r => r.Request.Method == HttpMethod.Put).Body);

        var turned = Editable([Edit("rotate", new { angle = 270 })]);
        Assert.Equal(new RotatedPhoto("turned"), await new ImmichClient(turned).RotateAsync(Account, PhotoId, 90, CancellationToken.None));
        Assert.Contains(turned.Requests, r => r.Request.Method == HttpMethod.Delete);
    }

    [Fact]
    public async Task APhotoImmichCannotEdit_SaysWhy_AndAKeyWithoutEditing_IsRefused()
    {
        var live = Editable([], HttpStatusCode.BadRequest);
        var e = await Assert.ThrowsAsync<ImmichException>(() => new ImmichClient(live).RotateAsync(Account, PhotoId, 90, CancellationToken.None));
        Assert.Equal("Immich can't rotate this photo: Editing live photos is not supported.", e.Message);

        var refused = Editable([], HttpStatusCode.Forbidden);
        e = await Assert.ThrowsAsync<ImmichException>(() => new ImmichClient(refused).RotateAsync(Account, PhotoId, 90, CancellationToken.None));
        Assert.True(e.KeyRefused);
        Assert.Contains("asset.edit.create", e.Message);
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
    public async Task APhoto_IsImmichsPreview_AsEditedInImmich()
    {
        var immich = new ScriptedImmich((_, _) =>
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([1, 2, 3]) { Headers = { ContentType = new("image/webp") } } });

        var photo = await new ImmichClient(immich).PhotoAsync(Account, AlbumId, CancellationToken.None);

        Assert.Equal("image/webp", photo!.ContentType);
        Assert.Equal($"http://immich.local:2283/api/assets/{AlbumId}/thumbnail?size=preview&edited=true", immich.Requests[0].Request.RequestUri!.ToString());
    }
}
