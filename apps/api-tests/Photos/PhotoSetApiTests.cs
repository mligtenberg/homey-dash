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

    // A sync is accepted at once; its Location is polled until the set is no longer syncing.
    private async Task<JsonElement> SyncedAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        for (var i = 0; ; i++)
        {
            var set = await _client.GetFromJsonAsync<JsonElement>(response.Headers.Location);
            if (!set.GetProperty("syncing").GetBoolean()) return set;
            Assert.True(i < 200, "The photo set is still syncing.");
            await Task.Delay(25);
        }
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

        var changed = await SyncedAsync(response);
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

        var synced = await SyncedAsync(response);
        Assert.Equal(JsonValueKind.Null, synced.GetProperty("syncError").ValueKind);
        Assert.Equal(
            set.GetProperty("photos").EnumerateArray().Select(p => p.GetProperty("id").GetString()),
            synced.GetProperty("photos").EnumerateArray().Select(p => p.GetProperty("id").GetString()));
    }

    private static string[] Ids(JsonElement set) =>
        [.. set.GetProperty("photos").EnumerateArray().Select(p => p.GetProperty("id").GetString()!)];

    [Fact]
    public async Task AnExcludedPhoto_LeavesTheSetAndNoSyncBringsItBack()
    {
        var set = await CreateAsync();
        var id = set.GetProperty("id").GetString()!;
        var photo = Ids(set)[3];

        var response = await _client.PutAsync($"/api/photo-sets/{id}/excluded/{photo}", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var excluded = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(photo, Ids(excluded));
        Assert.Equal([photo], excluded.GetProperty("excluded").EnumerateArray().Select(e => e.GetString()));
        // Still served, so Management can show what was excluded.
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync($"/api/photos/{id}/{photo}")).StatusCode);
        var synced = await SyncedAsync(await _client.PostAsync($"/api/photo-sets/{id}/sync", null));
        Assert.Equal(FakeImmich.SummerPhotos - 1, synced.GetProperty("photos").GetArrayLength());
        Assert.DoesNotContain(photo, Ids(synced));
        // Pointed at another album and back, it stays out.
        await SyncedAsync(await _client.PatchAsJsonAsync($"/api/photo-sets/{id}", new { albumId = FakeImmich.GardenId }));
        var back = await SyncedAsync(await _client.PatchAsJsonAsync($"/api/photo-sets/{id}", new { albumId = FakeImmich.SummerId }));
        Assert.DoesNotContain(photo, Ids(back));
    }

    [Fact]
    public async Task ABroughtBackPhoto_ReturnsWithTheAlbum()
    {
        var set = await CreateAsync();
        var id = set.GetProperty("id").GetString()!;
        var photo = Ids(set)[3];
        await _client.PutAsync($"/api/photo-sets/{id}/excluded/{photo}", null);

        var response = await _client.DeleteAsync($"/api/photo-sets/{id}/excluded/{photo}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var back = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, back.GetProperty("excluded").GetArrayLength());
        Assert.Equal(Ids(set), Ids(back));
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync($"/api/photo-sets/{id}/excluded/{photo}")).StatusCode);
    }

    [Fact]
    public async Task ExcludingTwice_IsFine_ButOnlyPhotosOfTheSetCanBe()
    {
        var set = await CreateAsync();
        var id = set.GetProperty("id").GetString()!;
        var photo = Ids(set)[0];

        await _client.PutAsync($"/api/photo-sets/{id}/excluded/{photo}", null);
        var again = await _client.PutAsync($"/api/photo-sets/{id}/excluded/{photo}", null);

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(FakeImmich.SummerPhotos - 1, (await again.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("photos").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PutAsync($"/api/photo-sets/{id}/excluded/not-in-the-set", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PutAsync($"/api/photo-sets/{Guid.NewGuid()}/excluded/{photo}", null)).StatusCode);
    }

    [Fact]
    public async Task ASelection_DrawsItsCountWithoutItsExcludedPhotos()
    {
        var set = await DrawAsync(Selection(count: 5));
        var id = set.GetProperty("id").GetString()!;
        var photo = Ids(set)[0];

        await _client.PutAsync($"/api/photo-sets/{id}/excluded/{photo}", null);
        var drawn = await SyncedAsync(await _client.PostAsync($"/api/photo-sets/{id}/sync", null));

        Assert.Equal(5, drawn.GetProperty("photos").GetArrayLength());
        Assert.DoesNotContain(photo, Ids(drawn));
    }

    private static object Selection(object[]? with = null, object[]? without = null, int count = 100, int refreshHours = 24) =>
        new { with = with ?? [], without = without ?? [], query = "landscape", count, refreshHours };

    private static readonly object Anna = new { id = FakeImmich.AnnaId, name = "Anna" };
    private static readonly object Bram = new { id = FakeImmich.BramId, name = "Bram" };
    private static readonly object Cas = new { id = FakeImmich.CasId, name = "Cas" };

    private async Task<JsonElement> DrawAsync(object selection)
    {
        return await SyncedAsync(await _client.PostAsJsonAsync("/api/photo-sets", new { name = "Family", selection }));
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

        var drawn = await SyncedAsync(await _client.PatchAsJsonAsync($"/api/photo-sets/{id}", new { selection = Selection(with: [Cas]) }));
        var album = await SyncedAsync(await _client.PatchAsJsonAsync($"/api/photo-sets/{id}", new { albumId = FakeImmich.GardenId }));

        Assert.Equal(JsonValueKind.Null, drawn.GetProperty("albumId").ValueKind);
        Assert.Equal(3, drawn.GetProperty("photos").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, album.GetProperty("selection").ValueKind);
        Assert.Equal("Garden", album.GetProperty("albumName").GetString());
    }

    // Anna is on the even Summer photos and Bram on every third, each with a face near the top, left on even photos and
    // right on odd ones; the others have no one on them.
    [Fact]
    public async Task ThePhotosFaces_AreReadAfterASync_AndKeptByTheNext()
    {
        var id = (await CreateAsync()).GetProperty("id").GetString()!;

        await factory.Services.GetRequiredService<PhotoSync>().ReadFacesAsync(CancellationToken.None);
        await SyncedAsync(await _client.PostAsync($"/api/photo-sets/{id}/sync", null));
        var photos = (await SetAsync(id)).GetProperty("photos").EnumerateArray().ToList();

        JsonElement Faces(int n) => photos[n - 1].GetProperty("faces");
        (double, double) Focus(int n) => (Faces(n).GetProperty("focus").GetProperty("x").GetDouble(), Faces(n).GetProperty("focus").GetProperty("y").GetDouble());
        string[] People(int n) => Faces(n).GetProperty("people").EnumerateArray().Select(p => p.GetString()!).ToArray();
        Assert.Equal((.2, .15), Focus(2));
        Assert.Equal((.8, .15), Focus(3));
        Assert.Equal((.5, .5), Focus(1));
        Assert.Equal(["Anna", "Bram"], People(6));
        Assert.Empty(People(1));
        Assert.Equal("Scheveningen, Netherlands", photos[0].GetProperty("place").GetString());
        Assert.Equal(JsonValueKind.Null, photos[3].GetProperty("place").ValueKind);
    }

    // Garden's first photo is upright, 1200 by 1600, with Cas's face near its top right. Turned back after, since the fake
    // Immich is shared.
    [Fact]
    public async Task ARotatedPhoto_IsTurnedInImmich_AndEverySetWithItShowsItTurned()
    {
        var first = await CreateAsync("Garden", FakeImmich.GardenId);
        var other = await CreateAsync("Garden too", FakeImmich.GardenId);
        string id = first.GetProperty("id").GetString()!, otherId = other.GetProperty("id").GetString()!;
        var photo = Ids(first)[0];
        var sync = factory.Services.GetRequiredService<PhotoSync>();
        await sync.ReadFacesAsync(CancellationToken.None);

        try
        {
            var response = await _client.PostAsJsonAsync($"/api/photo-sets/{id}/photos/{photo}/rotate", new { degrees = 90 });

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var rotated = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("photos")[0];
            Assert.Equal("turned-90", rotated.GetProperty("version").GetString());
            // Its faces moved with it, so they are read again.
            Assert.Equal(JsonValueKind.Null, rotated.GetProperty("faces").ValueKind);
            Assert.Equal("turned-90", (await SetAsync(otherId)).GetProperty("photos")[0].GetProperty("version").GetString());
            await sync.ReadFacesAsync(CancellationToken.None);
            var focus = (await SetAsync(id)).GetProperty("photos")[0].GetProperty("faces").GetProperty("focus");
            Assert.Equal((.85, .8), (focus.GetProperty("x").GetDouble(), focus.GetProperty("y").GetDouble()));
            var svg = await _client.GetStringAsync($"/api/photos/{id}/{photo}");
            Assert.Contains("width=\"1600\" height=\"1200\"", svg);
            // A sync keeps the turned photo's faces.
            await SyncedAsync(await _client.PostAsync($"/api/photo-sets/{id}/sync", null));
            Assert.NotEqual(JsonValueKind.Null, (await SetAsync(id)).GetProperty("photos")[0].GetProperty("faces").ValueKind);
        }
        finally
        {
            await _client.PostAsJsonAsync($"/api/photo-sets/{id}/photos/{photo}/rotate", new { degrees = -90 });
        }
        Assert.Equal(JsonValueKind.Null, (await SetAsync(id)).GetProperty("photos")[0].GetProperty("version").ValueKind);
    }

    [Fact]
    public async Task APhoto_IsFavoritedAsItsOwner()
    {
        var set = await CreateAsync();
        var id = set.GetProperty("id").GetString()!;
        var photo = Ids(set)[0];

        var ok = await _client.PutAsJsonAsync($"/api/photo-sets/{id}/photos/{photo}/favorite", new { favorite = true });
        var notOfTheSet = await _client.PutAsJsonAsync($"/api/photo-sets/{id}/photos/{Guid.NewGuid()}/favorite", new { favorite = true });

        Assert.Equal(HttpStatusCode.NoContent, ok.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, notOfTheSet.StatusCode);
    }

    [Fact]
    public async Task OnlyAQuarterTurnOfAPhotoOfTheSet_IsRotated()
    {
        var garden = await CreateAsync("Garden", FakeImmich.GardenId);
        var id = garden.GetProperty("id").GetString()!;
        var summerPhoto = Ids(await CreateAsync())[0];

        var half = await _client.PostAsJsonAsync($"/api/photo-sets/{id}/photos/{Ids(garden)[0]}/rotate", new { degrees = 180 });
        var notOfTheSet = await _client.PostAsJsonAsync($"/api/photo-sets/{id}/photos/{summerPhoto}/rotate", new { degrees = 90 });

        Assert.Equal(HttpStatusCode.BadRequest, half.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, notOfTheSet.StatusCode);
    }

    // In an API of its own, so the key given to Daan stays out of the others' tests.
    [Fact]
    public async Task APartnersPhoto_IsRotatedOnlyWithAKeyOfTheirs()
    {
        await using var own = new ApiFactory();
        var client = own.CreateClient();
        var partners = await client.GetFromJsonAsync<JsonElement>("/api/accounts/immich/1/partners");
        Assert.Equal("Daan", partners[0].GetProperty("name").GetString());
        Assert.False(partners[0].GetProperty("hasKey").GetBoolean());
        var created = await client.PostAsJsonAsync("/api/photo-sets", new { name = "Garden", albumId = FakeImmich.GardenId });
        var garden = await created.Content.ReadFromJsonAsync<JsonElement>();
        var (id, photo) = (garden.GetProperty("id").GetString(), Ids(garden)[2]);
        Assert.Equal(FakeImmich.Daan.Id, garden.GetProperty("photos")[2].GetProperty("ownerId").GetString());
        Assert.Equal([FakeImmich.Daan.Id], garden.GetProperty("lockedOwners").EnumerateArray().Select(o => o.GetString()));
        var keyless = await client.PostAsJsonAsync($"/api/photo-sets/{id}/photos/{photo}/rotate", new { degrees = 90 });
        Assert.Equal(HttpStatusCode.Conflict, keyless.StatusCode);

        var notTheirs = await client.PutAsJsonAsync($"/api/accounts/immich/1/partners/{FakeImmich.Daan.Id}", new { apiKey = FakeImmich.Account.ApiKey });
        Assert.Equal(HttpStatusCode.BadRequest, notTheirs.StatusCode);
        Assert.Contains("Fake's", await notTheirs.Content.ReadAsStringAsync());
        var keyed = await client.PutAsJsonAsync($"/api/accounts/immich/1/partners/{FakeImmich.Daan.Id}", new { apiKey = "daans-key" });
        Assert.True((await keyed.Content.ReadFromJsonAsync<JsonElement>())[0].GetProperty("hasKey").GetBoolean());
        var set = (await client.GetFromJsonAsync<JsonElement>($"/api/photo-sets/{id}"));
        Assert.Empty(set.GetProperty("lockedOwners").EnumerateArray());
        var rotated = await client.PostAsJsonAsync($"/api/photo-sets/{id}/photos/{photo}/rotate", new { degrees = 90 });
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);

        var removed = await client.DeleteAsync($"/api/accounts/immich/1/partners/{FakeImmich.Daan.Id}");
        Assert.False((await removed.Content.ReadFromJsonAsync<JsonElement>())[0].GetProperty("hasKey").GetBoolean());
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
