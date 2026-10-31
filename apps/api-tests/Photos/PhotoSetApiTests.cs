using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HomeyDash.Api.Data;
using HomeyDash.Api.Photos;
using Microsoft.Extensions.DependencyInjection;

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
        var albums = await _client.GetFromJsonAsync<JsonElement>("/api/accounts/immich/1/albums");

        Assert.Equal(["Garden", "Summer"], albums.EnumerateArray().Select(a => a.GetProperty("name").GetString()).Order());
    }

    [Fact]
    public async Task TheFakeAccount_IsTheOnlyOneAndCannotBeChanged()
    {
        var info = await _client.GetFromJsonAsync<JsonElement>("/api/accounts/immich");

        Assert.True(info.GetProperty("fake").GetBoolean());
        Assert.Equal(["Fake Immich"], info.GetProperty("accounts").EnumerateArray().Select(a => a.GetProperty("name").GetString()));
        var adding = await _client.PostAsJsonAsync("/api/accounts/immich", new { name = "Mine", address = "immich.local", apiKey = "key" });
        Assert.Equal(HttpStatusCode.Conflict, adding.StatusCode);
    }

    [Fact]
    public async Task APhotoSet_DrawsFromTheOldestAccountUnlessItNamesAnother()
    {
        var set = await CreateAsync();

        Assert.Equal(1, set.GetProperty("accountId").GetInt32());
        Assert.Equal("Fake Immich", set.GetProperty("accountName").GetString());
        var unknown = await _client.PostAsJsonAsync("/api/photo-sets", new { albumId = FakeImmich.SummerId, accountId = 7 });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
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
        var people = await _client.GetFromJsonAsync<JsonElement>("/api/accounts/immich/1/people");

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

    // Accounts as if set up earlier, since checking a new one needs an Immich that answers.
    private async Task<int[]> SeedAsync(params string[] names)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
        var accounts = names.Select(name => new ImmichAccount("http://127.0.0.1:1", "key") { Name = name }).ToList();
        db.ImmichAccounts.AddRange(accounts);
        await db.SaveChangesAsync();
        scope.ServiceProvider.GetRequiredService<ImmichAccounts>().Set(db.ImmichAccounts.ToList());
        return [.. accounts.Select(a => a.Id)];
    }

    private async Task RemoveAllAsync()
    {
        foreach (var account in (await _client.GetFromJsonAsync<JsonElement>("/api/accounts/immich")).GetProperty("accounts").EnumerateArray())
            await _client.DeleteAsync($"/api/accounts/immich/{account.GetProperty("id").GetInt32()}");
    }

    [Fact]
    public async Task AccountsOfAHome_ListOldestFirstWithoutTheirKeys()
    {
        await RemoveAllAsync();
        await SeedAsync("Martin", "Anna");

        var accounts = (await _client.GetFromJsonAsync<JsonElement>("/api/accounts/immich")).GetProperty("accounts").EnumerateArray().ToList();

        Assert.Equal(["Martin", "Anna"], accounts.Select(a => a.GetProperty("name").GetString()));
        Assert.All(accounts, a => Assert.False(a.TryGetProperty("apiKey", out _)));
    }

    [Fact]
    public async Task TwoAccounts_CannotShareAName()
    {
        await RemoveAllAsync();
        var ids = await SeedAsync("Home", "Studio");

        // The address and key stay the same, so Immich isn't asked.
        var response = await _client.PutAsJsonAsync($"/api/accounts/immich/{ids[1]}", new { name = " home ", address = "127.0.0.1:1" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("errors").TryGetProperty("name", out _));
        var renamed = await _client.PutAsJsonAsync($"/api/accounts/immich/{ids[1]}", new { name = "Attic", address = "127.0.0.1:1" });
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
    }

    [Fact]
    public async Task RemovingAnAccount_LeavesItsPhotoSetsWithoutOne()
    {
        await RemoveAllAsync();
        var ids = await SeedAsync("Home", "Studio");
        var setId = Guid.NewGuid();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>();
            db.PhotoSets.Add(new PhotoSet { Id = setId, Name = "Studio shots", AccountId = ids[1], AlbumId = FakeImmich.SummerId });
            await db.SaveChangesAsync();
        }

        Assert.Equal(HttpStatusCode.OK, (await _client.DeleteAsync($"/api/accounts/immich/{ids[1]}")).StatusCode);

        JsonElement set = default;
        for (var i = 0; i < 100; i++)
        {
            set = (await _client.GetFromJsonAsync<JsonElement>("/api/photo-sets")).EnumerateArray().Single(s => s.GetProperty("id").GetGuid() == setId);
            if (set.GetProperty("syncError").ValueKind == JsonValueKind.String) break;
            await Task.Delay(50);
        }
        Assert.Equal(JsonValueKind.Null, set.GetProperty("accountId").ValueKind);
        Assert.Contains("account was removed", set.GetProperty("syncError").GetString());
    }

    [Fact]
    public async Task WithoutAnAccount_PhotoSetsAreRefused()
    {
        await RemoveAllAsync();
        var response = await _client.PostAsJsonAsync("/api/photo-sets", new { name = "Summer", albumId = FakeImmich.SummerId });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task AnAddressWhereNoImmichAnswers_IsRefused()
    {
        await RemoveAllAsync();

        var response = await _client.PostAsJsonAsync("/api/accounts/immich", new { name = "Home", address = "127.0.0.1:1", apiKey = "key" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("errors").TryGetProperty("address", out _));
        Assert.Equal(0, (await _client.GetFromJsonAsync<JsonElement>("/api/accounts/immich")).GetProperty("accounts").GetArrayLength());
    }
}
