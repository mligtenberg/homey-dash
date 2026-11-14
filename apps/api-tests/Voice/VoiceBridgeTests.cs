using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace HomeyDash.Api.Tests.Voice;

/// <summary>A stand-in for apps/voice: waits for the screen to be armed, then answers with the result it is given.</summary>
public sealed class FakeVoiceService : IAsyncDisposable
{
    private readonly WebApplication _app;

    public string Address { get; }
    public string? Query { get; private set; }

    public FakeVoiceService(Func<string> result)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        _app = builder.Build();
        _app.UseWebSockets();
        _app.Map("/ws/listen", async context =>
        {
            Query = context.Request.QueryString.Value;
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var buffer = new byte[1024];
            await socket.ReceiveAsync(buffer, default); // "arm"
            await socket.SendAsync(Encoding.UTF8.GetBytes("""{"type":"state","state":"awake","wake":"jarvis"}"""), WebSocketMessageType.Text, true, default);
            await socket.SendAsync(Encoding.UTF8.GetBytes(result()), WebSocketMessageType.Text, true, default);
            await socket.ReceiveAsync(buffer, default);
        });
        _app.Start();
        Address = _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
    }

    public ValueTask DisposeAsync() => _app.DisposeAsync();
}

public sealed class VoiceApiFactory(string voiceAddress) : ApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Voice:Address", voiceAddress);
    }
}

public class VoiceBridgeTests
{
    private static async Task<List<JsonElement>> SpeakAsync(VoiceApiFactory api, Guid screen)
    {
        using var socket = await api.Server.CreateWebSocketClient().ConnectAsync(new Uri($"ws://localhost/api/voice/listen?screen={screen}"), default);
        await socket.SendAsync(Encoding.UTF8.GetBytes("""{"type":"arm"}"""), WebSocketMessageType.Text, true, default);
        var events = new List<JsonElement>();
        var buffer = new byte[8192];
        while (true)
        {
            var received = await socket.ReceiveAsync(buffer, default);
            var e = JsonSerializer.Deserialize<JsonElement>(Encoding.UTF8.GetString(buffer, 0, received.Count));
            events.Add(e);
            if (e.GetProperty("type").GetString() == "result") return events;
        }
    }

    [Fact]
    public async Task ACommand_IsCarriedOutInHomey_AndTheScreenHearsHowItWent()
    {
        var light = "";
        await using var voice = new FakeVoiceService(() => $$"""{"type":"result","ok":true,"action":"lights_off","value":null,"zones":["x"],"reason":null,"command_text":"doe de lichten uit","commands":[{"device":"{{light}}","name":"l","zone":"x","capability":"onoff","value":false}]}""");
        await using var api = new VoiceApiFactory(voice.Address);
        var client = api.CreateClient();
        var devices = await client.GetFromJsonAsync<JsonElement>("/api/homey/devices");
        var lamp = devices.EnumerateArray().First(d => d.GetProperty("capabilities").TryGetProperty("onoff", out var c) && c.GetProperty("setable").GetBoolean()
            && d.GetProperty("capabilities").GetProperty("onoff").GetProperty("value").GetBoolean());
        light = lamp.GetProperty("id").GetString()!;

        var events = await SpeakAsync(api, Guid.NewGuid());

        Assert.Equal("awake", events[0].GetProperty("state").GetString());
        Assert.True(events[^1].GetProperty("ok").GetBoolean());
        var after = await client.GetFromJsonAsync<JsonElement>("/api/homey/devices");
        var now = after.EnumerateArray().First(d => d.GetProperty("id").GetString() == light);
        Assert.False(now.GetProperty("capabilities").GetProperty("onoff").GetProperty("value").GetBoolean());
    }

    [Fact]
    public async Task ACommand_ForADeviceHomeyDoesNotHave_IsAnswered_WithARefusal()
    {
        await using var voice = new FakeVoiceService(() => """{"type":"result","ok":true,"action":"lights_off","value":null,"zones":["x"],"reason":null,"commands":[{"device":"d1","name":"l","zone":"x","capability":"onoff","value":false}]}""");
        await using var api = new VoiceApiFactory(voice.Address);

        var result = (await SpeakAsync(api, Guid.NewGuid()))[^1];

        Assert.False(result.GetProperty("ok").GetBoolean());
        Assert.Equal("Homey did not do it", result.GetProperty("reason").GetString());
        Assert.Contains("d1", result.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task ATimer_IsSetForEveryScreen()
    {
        await using var voice = new FakeVoiceService(() => """{"type":"result","ok":true,"action":"timer","value":{"seconds":600,"name":"Pasta"},"zones":[],"reason":null,"commands":[]}""");
        await using var api = new VoiceApiFactory(voice.Address);

        var result = (await SpeakAsync(api, Guid.NewGuid()))[^1];

        Assert.True(result.GetProperty("ok").GetBoolean());
        var timers = await api.Services.CreateScope().ServiceProvider.GetRequiredService<HomeyDash.Api.Data.HomeyDashDbContext>()
            .Timers.ToListAsync();
        Assert.Contains(timers, t => t.Name == "Pasta" && t.Seconds == 600);
    }

    [Fact]
    public async Task ATimer_RingsWithTheSoundSetOnTheDisplay()
    {
        await using var voice = new FakeVoiceService(() => """{"type":"result","ok":true,"action":"timer","value":{"seconds":60,"name":null},"zones":[],"reason":null,"commands":[]}""");
        await using var api = new VoiceApiFactory(voice.Address);
        var client = api.CreateClient();
        var screen = Guid.NewGuid();
        var created = await client.PostAsJsonAsync("/api/displays", new { name = "Kitchen", screenId = screen });
        var display = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/displays/{display}/timer-sound", new { sound = "kazoo" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/api/displays/{display}/timer-sound", new { sound = "bell" })).StatusCode);

        await SpeakAsync(api, screen);

        var timers = await api.Services.CreateScope().ServiceProvider.GetRequiredService<HomeyDash.Api.Data.HomeyDashDbContext>().Timers.ToListAsync();
        Assert.Equal("bell", Assert.Single(timers).Sound);
    }

    [Fact]
    public async Task TheScreensZone_GoesToTheVoiceService()
    {
        await using var voice = new FakeVoiceService(() => """{"type":"result","ok":false,"reason":"hoeveel procent?","zones":[],"commands":[]}""");
        await using var api = new VoiceApiFactory(voice.Address);
        var client = api.CreateClient();
        var screen = Guid.NewGuid();
        var created = await client.PostAsJsonAsync("/api/displays", new { name = "Hall", screenId = screen });
        var display = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        var account = (await client.GetFromJsonAsync<JsonElement>("/api/homey/status")).GetProperty("accountId").GetInt32();
        var inZone = (await client.GetFromJsonAsync<JsonElement>("/api/homey/devices")).EnumerateArray().First(d => d.GetProperty("zoneId").ValueKind == JsonValueKind.String);
        await client.PutAsJsonAsync($"/api/displays/{display}/zone", new { accountId = account, zoneId = inZone.GetProperty("zoneId").GetString() });

        await SpeakAsync(api, screen);

        Assert.Contains($"zone={Uri.EscapeDataString(inZone.GetProperty("zoneName").GetString()!)}", voice.Query);
    }

    [Fact]
    public async Task WhatWasHeardAndDone_CanBeReadBack()
    {
        var answer = """{"type":"result","ok":true,"action":"timer","value":{"seconds":600,"name":"Pasta"},"zones":[],"reason":null,"command_text":"zet een timer van tien minuten","commands":[]}""";
        await using var voice = new FakeVoiceService(() => answer);
        await using var api = new VoiceApiFactory(voice.Address);
        var client = api.CreateClient();
        var screen = Guid.NewGuid();

        await SpeakAsync(api, screen);
        answer = """{"type":"result","ok":true,"action":"lights_off","value":null,"zones":["x"],"reason":null,"commands":[{"device":"d1","name":"l","zone":"x","capability":"onoff","value":false}]}""";
        await SpeakAsync(api, screen);

        var log = await client.GetFromJsonAsync<JsonElement>("/api/voice/log");
        var failed = log[0];
        Assert.Equal("failed", failed.GetProperty("outcome").GetString());
        Assert.Equal("d1", failed.GetProperty("asked")[0].GetProperty("device").GetString());
        var step = Assert.Single(failed.GetProperty("steps").EnumerateArray());
        Assert.False(step.GetProperty("ok").GetBoolean());
        Assert.Contains("d1", step.GetProperty("error").GetString());
        var timer = log[1];
        Assert.Equal("done", timer.GetProperty("outcome").GetString());
        Assert.Equal(screen, timer.GetProperty("screen").GetGuid());
        Assert.Equal("zet een timer van tien minuten", timer.GetProperty("command").GetString());
        Assert.Equal("timer", timer.GetProperty("steps")[0].GetProperty("what").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/voice/log")).StatusCode);
        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>("/api/voice/log")).GetArrayLength());
    }

    [Fact]
    public async Task AVoiceServiceThatIsGone_IsNoted()
    {
        await using var api = new VoiceApiFactory("http://127.0.0.1:9");
        await Assert.ThrowsAnyAsync<Exception>(() => SpeakAsync(api, Guid.NewGuid()));

        var log = await api.CreateClient().GetFromJsonAsync<JsonElement>("/api/voice/log");
        Assert.Equal("unreachable", log[0].GetProperty("outcome").GetString());
    }
}
