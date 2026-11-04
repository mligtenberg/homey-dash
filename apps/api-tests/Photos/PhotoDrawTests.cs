using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using HomeyDash.Api.Photos;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace HomeyDash.Api.Tests.Photos;

// A selection's photos come in while it draws, against an Immich that draws a photo whenever the test hands it one.
public class PhotoDrawTests(PhotoDrawTests.Factory factory) : IClassFixture<PhotoDrawTests.Factory>
{
    public sealed class Factory : ApiFactory
    {
        public Channel<Photo>? Drawing { get; set; }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureTestServices(services => services.AddSingleton<IImmich>(s =>
                new HandedImmich(new FakeImmich(TimeProvider.System), () => Drawing!)));
        }
    }

    // FakeImmich, but for what a selection draws.
    private sealed class HandedImmich(FakeImmich fake, Func<Channel<Photo>> drawing) : IImmich
    {
        public Task CheckAsync(ImmichAccount account, CancellationToken ct) => fake.CheckAsync(account, ct);
        public Task<ImmichUser> UserAsync(ImmichAccount account, CancellationToken ct) => fake.UserAsync(account, ct);
        public Task<IReadOnlyList<ImmichUser>> PartnersAsync(ImmichAccount account, CancellationToken ct) => fake.PartnersAsync(account, ct);
        public Task<IReadOnlyList<ImmichAlbum>> AlbumsAsync(ImmichAccount account, CancellationToken ct) => fake.AlbumsAsync(account, ct);
        public Task<ImmichAlbumContents?> AlbumAsync(ImmichAccount account, string albumId, CancellationToken ct) => fake.AlbumAsync(account, albumId, ct);
        public Task<IReadOnlyList<ImmichPerson>> PeopleAsync(ImmichAccount account, CancellationToken ct) => fake.PeopleAsync(account, ct);
        public Task<Faces?> FacesAsync(ImmichAccount account, string photoId, CancellationToken ct) => fake.FacesAsync(account, photoId, ct);
        public Task<ImmichPhoto?> PhotoAsync(ImmichAccount account, string photoId, CancellationToken ct) => fake.PhotoAsync(account, photoId, ct);
        public Task<RotatedPhoto?> RotateAsync(ImmichAccount account, string photoId, int degrees, CancellationToken ct) =>
            fake.RotateAsync(account, photoId, degrees, ct);

        public async IAsyncEnumerable<Photo> DrawAsync(
            ImmichAccount account, PhotoSelection selection, [EnumeratorCancellation] CancellationToken ct)
        {
            await foreach (var photo in drawing().Reader.ReadAllAsync(ct)) yield return photo;
        }
    }

    private readonly HttpClient _client = factory.CreateClient();

    private static Photo Drawn(int n) => new($"p{n}", null);

    private async Task<JsonElement> WhenAsync(string location, Func<JsonElement, bool> done)
    {
        for (var i = 0; ; i++)
        {
            var set = await _client.GetFromJsonAsync<JsonElement>(location);
            if (done(set)) return set;
            Assert.True(i < 200, "The photo set never got there.");
            await Task.Delay(25);
        }
    }

    private static string[] Ids(JsonElement set) =>
        [.. set.GetProperty("photos").EnumerateArray().Select(p => p.GetProperty("id").GetString()!)];

    [Fact]
    public async Task ASelectionsPhotos_ComeInWhileItDraws()
    {
        factory.Drawing = Channel.CreateUnbounded<Photo>();
        var selection = new { with = Array.Empty<object>(), without = Array.Empty<object>(), query = (string?)null, count = 5, refreshHours = 24 };

        var response = await _client.PostAsJsonAsync("/api/photo-sets", new { name = "Family", selection });

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var location = response.Headers.Location!.ToString();
        factory.Drawing.Writer.TryWrite(Drawn(1));
        var first = await WhenAsync(location, s => s.GetProperty("photos").GetArrayLength() > 0);
        Assert.True(first.GetProperty("syncing").GetBoolean());
        Assert.Equal(["p1"], Ids(first));

        factory.Drawing.Writer.TryWrite(Drawn(2));
        factory.Drawing.Writer.Complete();
        var done = await WhenAsync(location, s => !s.GetProperty("syncing").GetBoolean());
        Assert.Equal(["p1", "p2"], Ids(done));
    }

    [Fact]
    public async Task ADrawThatFailsPartWay_PutsBackThePhotosFromBefore()
    {
        factory.Drawing = Channel.CreateUnbounded<Photo>();
        factory.Drawing.Writer.TryWrite(Drawn(1));
        factory.Drawing.Writer.Complete();
        var selection = new { with = Array.Empty<object>(), without = Array.Empty<object>(), query = (string?)null, count = 5, refreshHours = 24 };
        var location = (await _client.PostAsJsonAsync("/api/photo-sets", new { name = "Family", selection })).Headers.Location!.ToString();
        await WhenAsync(location, s => !s.GetProperty("syncing").GetBoolean());

        factory.Drawing = Channel.CreateUnbounded<Photo>();
        var response = await _client.PostAsync($"{location}/sync", null);
        factory.Drawing.Writer.TryWrite(Drawn(2));
        await WhenAsync(location, s => Ids(s).SequenceEqual(["p2"]));
        factory.Drawing.Writer.Complete(new ImmichException("Immich is out of reach."));

        var failed = await WhenAsync(location, s => !s.GetProperty("syncing").GetBoolean());
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(["p1"], Ids(failed));
        Assert.Equal("Immich is out of reach.", failed.GetProperty("syncError").GetString());
    }
}
