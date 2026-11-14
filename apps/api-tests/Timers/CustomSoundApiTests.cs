using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace HomeyDash.Api.Tests.Timers;

public class CustomSoundApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    // An MP3 starts with an ID3 tag; the rest is whatever.
    private static readonly byte[] Mp3 = [.. "ID3"u8, 4, 0, 0, 0, 0, 0, 0, 1, 2, 3];

    private static MultipartFormDataContent Upload(byte[] bytes, string fileName = "ding.mp3")
    {
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        form.Add(file, "file", fileName);
        return form;
    }

    private async Task<JsonElement> UploadAsync(string url = "/api/sounds")
    {
        var response = await _client.PostAsync(url, Upload(Mp3));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task AnUploadedSound_IsListedNamedAndServed()
    {
        var sound = await UploadAsync("/api/sounds?name=Doorbell");
        Assert.Equal("Doorbell", sound.GetProperty("name").GetString());
        Assert.StartsWith("custom:", sound.GetProperty("id").GetString());

        var listed = await _client.GetFromJsonAsync<JsonElement>("/api/sounds");
        Assert.Contains(listed.EnumerateArray(), s => s.GetProperty("id").GetString() == sound.GetProperty("id").GetString());

        var audio = await _client.GetAsync(sound.GetProperty("url").GetString());
        Assert.Equal("audio/mpeg", audio.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Mp3, await audio.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task ASoundWithoutAName_TakesItsFileName()
    {
        var sound = await UploadAsync();
        Assert.Equal("ding", sound.GetProperty("name").GetString());
    }

    [Fact]
    public async Task ANonAudioFile_IsRefused()
    {
        var response = await _client.PostAsync("/api/sounds", Upload("not a sound"u8.ToArray(), "x.mp3"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ARenamedSound_KeepsItsAudio()
    {
        var sound = await UploadAsync();
        var id = sound.GetProperty("id").GetString()!["custom:".Length..];
        var renamed = await _client.PatchAsJsonAsync($"/api/sounds/{id}", new { name = "Gong" });
        Assert.Equal("Gong", (await renamed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("name").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PatchAsJsonAsync($"/api/sounds/{id}", new { name = " " })).StatusCode);
    }

    [Fact]
    public async Task ADeletedSound_MakesADisplayBeepAgain()
    {
        var sound = await UploadAsync();
        var soundId = sound.GetProperty("id").GetString()!;
        var created = await _client.PostAsJsonAsync("/api/displays", new { name = "Hallway", screenId = Guid.NewGuid() });
        var display = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        var set = await _client.PutAsJsonAsync($"/api/displays/{display}/timer-sound", new { sound = soundId });
        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        Assert.Equal(soundId, (await set.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("timerSound").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/sounds/{soundId["custom:".Length..]}")).StatusCode);
        var after = (await _client.GetFromJsonAsync<JsonElement>("/api/displays")).EnumerateArray().Single(d => d.GetProperty("id").GetString() == display);
        Assert.Equal(JsonValueKind.Null, after.GetProperty("timerSound").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync(sound.GetProperty("url").GetString())).StatusCode);
    }

    [Fact]
    public async Task ADisplayCannotRingWithAnInventedSound()
    {
        var created = await _client.PostAsJsonAsync("/api/displays", new { name = "Hallway", screenId = Guid.NewGuid() });
        var display = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        var response = await _client.PutAsJsonAsync($"/api/displays/{display}/timer-sound", new { sound = "custom:nope" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
