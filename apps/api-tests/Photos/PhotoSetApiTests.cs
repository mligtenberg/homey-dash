using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HomeyDash.Api.Photos;

namespace HomeyDash.Api.Tests.Photos;

// Against FakeImmich, whose Summer album has 12 photos and a video, and whose Garden album has 3 photos.
public class PhotoSetApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<JsonElement> CreateAsync(string? name = "Summer", string albumId = FakeImmich.SummerId)
    {
        var response = await _client.PostAsJsonAsync("/api/photo-sets", new { name, albumId });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<JsonElement> SetAsync(string id) =>
        (await _client.GetFromJsonAsync<JsonElement>("/api/photo-sets")).EnumerateArray().Single(s => s.GetProperty("id").GetString() == id);

    [Fact]
    public async Task Albums_ListWhatTheAccountCanSee()
    {
        var albums = await _client.GetFromJsonAsync<JsonElement>("/api/accounts/immich/albums");

        Assert.Equal(["Garden", "Summer"], albums.EnumerateArray().Select(a => a.GetProperty("name").GetString()).Order());
    }

    [Fact]
    public async Task APhotoSet_ArrivesWithTheAlbumsPhotosButNotItsVideos()
    {
        var set = await CreateAsync();

        var photos = set.GetProperty("photos").EnumerateArray().ToList();
        Assert.Equal(FakeImmich.SummerPhotos, photos.Count);
        Assert.Equal(1, set.GetProperty("skippedVideos").GetInt32());
        Assert.Equal("Summer", set.GetProperty("albumName").GetString());
        var photo = await _client.GetAsync($"/api/photos/{set.GetProperty("id").GetString()}/{photos[0].GetProperty("id").GetString()}");
        Assert.Equal(HttpStatusCode.OK, photo.StatusCode);
        Assert.Equal("image/svg+xml", photo.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task APhotoSetWithoutAName_TakesTheAlbums()
    {
        var set = await CreateAsync(name: null, albumId: FakeImmich.GardenId);

        Assert.Equal("Garden", set.GetProperty("name").GetString());
    }

    [Fact]
    public async Task AnotherAlbum_ReplacesThePhotos()
    {
        var set = await CreateAsync();
        var id = set.GetProperty("id").GetString()!;
        var first = set.GetProperty("photos")[0].GetProperty("id").GetString();

        var response = await _client.PatchAsJsonAsync($"/api/photo-sets/{id}", new { albumId = FakeImmich.GardenId });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var changed = await SetAsync(id);
        Assert.Equal(3, changed.GetProperty("photos").GetArrayLength());
        Assert.Equal("Summer", changed.GetProperty("name").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/photos/{id}/{first}")).StatusCode);
    }

    [Fact]
    public async Task OnlyPhotosOfTheSet_AreFetchedFromImmich()
    {
        var garden = await CreateAsync(albumId: FakeImmich.GardenId);
        var summer = await CreateAsync();
        var summerPhoto = summer.GetProperty("photos")[0].GetProperty("id").GetString();

        var response = await _client.GetAsync($"/api/photos/{garden.GetProperty("id").GetString()}/{summerPhoto}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task AnAlbumNotInImmich_IsRefused()
    {
        var response = await _client.PostAsJsonAsync("/api/photo-sets", new { name = "Gone", albumId = Guid.NewGuid() });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Syncing_KeepsTheSetAsItIsWhenTheAlbumIsTheSame()
    {
        var set = await CreateAsync();
        var id = set.GetProperty("id").GetString()!;

        var response = await _client.PostAsync($"/api/photo-sets/{id}/sync", null);

        var synced = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(JsonValueKind.Null, synced.GetProperty("syncError").ValueKind);
        Assert.Equal(
            set.GetProperty("photos").EnumerateArray().Select(p => p.GetProperty("id").GetString()),
            synced.GetProperty("photos").EnumerateArray().Select(p => p.GetProperty("id").GetString()));
    }

    private static object Selection(object[]? with = null, object[]? without = null, int count = 100, int refreshHours = 24) =>
        new { with = with ?? [], without = without ?? [], query = "landscape", count, refreshHours };

    private static readonly object Anna = new { id = FakeImmich.AnnaId, name = "Anna" };
    private static readonly object Bram = new { id = FakeImmich.BramId, name = "Bram" };
    private static readonly object Cas = new { id = FakeImmich.CasId, name = "Cas" };

    private async Task<JsonElement> DrawAsync(object selection)
    {
        var response = await _client.PostAsJsonAsync("/api/photo-sets", new { name = "Family", selection });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static int[] Numbers(JsonElement set) =>
        [.. set.GetProperty("photos").EnumerateArray().Select(p => Convert.ToInt32(p.GetProperty("id").GetString()![^2..], 16)).Order()];

    [Fact]
    public async Task People_AreThoseWithANameInImmich()
    {
        var people = await _client.GetFromJsonAsync<JsonElement>("/api/accounts/immich/people");

        Assert.Equal(["Anna", "Bram", "Cas"], people.EnumerateArray().Select(p => p.GetProperty("name").GetString()));
    }

    [Fact]
    public async Task ASelection_DrawsPhotosWithAnyOfItsPeopleAndNoneOfTheOthers()
    {
        // Summer photos: Anna on the even ones, Bram on every third. Cas only in Garden.
        var set = await DrawAsync(Selection(with: [Anna, Cas], without: [Bram]));

        Assert.Equal(JsonValueKind.Null, set.GetProperty("albumId").ValueKind);
        Assert.Equal("landscape", set.GetProperty("selection").GetProperty("query").GetString());
        // Anna's 2, 4, 8, 10 (not 6 and 12, which have Bram) and Cas's 1, 2, 3 from Garden.
        Assert.Equal([1, 2, 2, 3, 4, 8, 10], Numbers(set));
    }

    [Fact]
    public async Task ASelection_DrawsAtMostItsCount()
    {
        var set = await DrawAsync(Selection(count: 5));

        Assert.Equal(5, set.GetProperty("photos").GetArrayLength());
    }

    [Theory]
    [InlineData(0, 24)]
    [InlineData(1001, 24)]
    [InlineData(100, 5)]
    public async Task ASelectionOutOfBounds_IsRefused(int count, int refreshHours)
    {
        var response = await _client.PostAsJsonAsync("/api/photo-sets", new { name = "Family", selection = Selection(count: count, refreshHours: refreshHours) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task SomeoneBothInAndOut_IsRefused()
    {
        var response = await _client.PostAsJsonAsync("/api/photo-sets", new { name = "Family", selection = Selection(with: [Anna], without: [Anna]) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AnAlbumSet_CanTurnIntoASelectionAndBack()
    {
        var id = (await CreateAsync()).GetProperty("id").GetString()!;

        await _client.PatchAsJsonAsync($"/api/photo-sets/{id}", new { selection = Selection(with: [Cas]) });
        var drawn = await SetAsync(id);
        await _client.PatchAsJsonAsync($"/api/photo-sets/{id}", new { albumId = FakeImmich.GardenId });
        var album = await SetAsync(id);

        Assert.Equal(JsonValueKind.Null, drawn.GetProperty("albumId").ValueKind);
        Assert.Equal(3, drawn.GetProperty("photos").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, album.GetProperty("selection").ValueKind);
        Assert.Equal("Garden", album.GetProperty("albumName").GetString());
    }

    [Fact]
    public async Task ADeletedPhotoSet_MakesItsTilesMissing()
    {
        var set = await CreateAsync();
        var id = set.GetProperty("id").GetString()!;
        var target = set.GetProperty("target").GetString()!;
        var dashboard = (await (await _client.PostAsJsonAsync("/api/dashboards", new { name = "Kitchen" }))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        await _client.PutAsJsonAsync($"/api/dashboards/{dashboard}/draft", new
        {
            rows = 4,
            sections = new[]
            {
                new
                {
                    id = "s", title = (string?)null,
                    tiles = new[] { new { id = "t", kind = "photo", size = "large", position = new { column = 0, row = 0 }, settings = new { target } } },
                },
            },
        });
        Assert.Equal(["Kitchen"], (await SetAsync(id)).GetProperty("dashboards").EnumerateArray().Select(d => d.GetString()));
        Assert.Equal(0, await MissingAsync(dashboard!));

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/photo-sets/{id}")).StatusCode);

        Assert.Equal(1, await MissingAsync(dashboard!));
    }

    [Theory]
    [InlineData("   ")]
    [InlineData("")]
    public async Task ABlankRename_IsRefused(string name)
    {
        var id = (await CreateAsync()).GetProperty("id").GetString();

        var response = await _client.PatchAsJsonAsync($"/api/photo-sets/{id}", new { name });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private async Task<int> MissingAsync(string dashboard) =>
        (await _client.GetFromJsonAsync<JsonElement>($"/api/dashboards/{dashboard}")).GetProperty("missingTiles").GetInt32();
}

// Against the real Immich client, before any Immich account is set up.
public class ImmichAccountApiTests(RealImmichApiFactory factory) : IClassFixture<RealImmichApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task WithoutAnAccount_PhotoSetsAreRefused()
    {
        var response = await _client.PostAsJsonAsync("/api/photo-sets", new { name = "Summer", albumId = FakeImmich.SummerId });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task AnAddressWhereNoImmichAnswers_IsRefused()
    {
        var response = await _client.PutAsJsonAsync("/api/accounts/immich", new { address = "127.0.0.1:1", apiKey = "key" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("errors").TryGetProperty("address", out _));
        Assert.Equal(JsonValueKind.Null, (await _client.GetFromJsonAsync<JsonElement>("/api/accounts/immich")).GetProperty("address").ValueKind);
    }
}
