using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using HomeyDash.Api.Data;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Voice;

/// <summary>
/// Voice, as the screens use it. The screen hears the wake word itself, then opens a socket here and sends the audio;
/// HomeyDash has the voice service (apps/voice) turn it into text and a command, carries the command out, and
/// tells the screen how it went. The screen never talks to the voice service.
/// </summary>
public static class VoiceEndpoints
{
    public const string Path = "/voice/listen";

    // How the voice service may hear the wake word written; the screen's on-device model is "hey jarvis".
    private const string WakeSpellings = "hey jarvis,jarvis,jervis,jarvas";

    public static void MapVoice(this IEndpointRouteBuilder api) => api.Map(Path, ListenAsync);

    private static async Task ListenAsync(HttpContext context, IConfiguration configuration, HomeyDashDbContext db, Homeys homeys,
        RealtimeNotifier notifier, TimeProvider time, ILoggerFactory logs)
    {
        var log = logs.CreateLogger("HomeyDash.Api.Voice");
        if (!context.WebSockets.IsWebSocketRequest) { context.Response.StatusCode = StatusCodes.Status400BadRequest; return; }
        if (configuration["Voice:Address"] is not { Length: > 0 } address
            || !Guid.TryParse(context.Request.Query["screen"], out var screen))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        // The zone the screen is in, which a command that names no room means.
        var display = await db.Displays.AsNoTracking().FirstOrDefaultAsync(d => d.ScreenId == screen, context.RequestAborted);
        var zone = display?.ZoneId is { } zoneId
            ? homeys.For(display.ZoneAccountId)?.State.Zones.FirstOrDefault(z => z.Id == zoneId)?.Name
            : null;

        var upstreamUri = new UriBuilder(address) { Path = "/ws/listen", Query = $"wake={Uri.EscapeDataString(WakeSpellings)}" + (zone is null ? "" : $"&zone={Uri.EscapeDataString(zone)}")
            + (context.Request.Query["detect"] == "1" ? "&detect=true" : "") };
        upstreamUri.Scheme = upstreamUri.Scheme == Uri.UriSchemeHttps ? "wss" : "ws";
        using var upstream = new ClientWebSocket();
        try
        {
            await upstream.ConnectAsync(upstreamUri.Uri, context.RequestAborted);
        }
        catch (Exception e) when (e is WebSocketException or HttpRequestException)
        {
            log.LogWarning("Voice service not reachable at {Address}: {Message}", address, e.Message);
            context.Response.StatusCode = StatusCodes.Status502BadGateway;
            return;
        }

        using var browser = await context.WebSockets.AcceptWebSocketAsync();
        var executor = new VoiceExecutor(homeys, db, notifier, time, display?.TimerSound);
        using var done = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        var toService = Forward(browser, upstream, done.Token);
        var toScreen = ForwardEvents(upstream, browser, executor, log, done.Token);
        await Task.WhenAny(toService, toScreen);
        await done.CancelAsync();
        try { await Task.WhenAll(toService, toScreen); } catch (Exception e) when (e is OperationCanceledException or WebSocketException) { }
    }

    // Audio and the arm message, as they come.
    private static async Task Forward(WebSocket from, WebSocket to, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        while (!ct.IsCancellationRequested && from.State == WebSocketState.Open)
        {
            var received = await from.ReceiveAsync(buffer, ct);
            if (received.MessageType == WebSocketMessageType.Close) break;
            await to.SendAsync(buffer.AsMemory(0, received.Count), received.MessageType, received.EndOfMessage, ct);
        }
    }

    // What the voice service says, whole messages; a result is carried out first and goes on with how it went.
    private static async Task ForwardEvents(WebSocket service, WebSocket screen, VoiceExecutor executor, ILogger log, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        using var message = new MemoryStream();
        while (!ct.IsCancellationRequested && service.State == WebSocketState.Open && screen.State == WebSocketState.Open)
        {
            var received = await service.ReceiveAsync(buffer, ct);
            if (received.MessageType == WebSocketMessageType.Close) break;
            message.Write(buffer, 0, received.Count);
            if (!received.EndOfMessage) continue;
            var text = Encoding.UTF8.GetString(message.ToArray());
            message.SetLength(0);
            if (JsonNode.Parse(text) is { } node && node["type"]?.GetValue<string>() == "result")
            {
                node = await executor.RunAsync(node, ct);
                log.LogInformation("Voice command {Text} -> {Action}, ok {Ok}", node["command_text"], node["action"], node["ok"]);
                text = node.ToJsonString();
            }
            await screen.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, ct);
        }
    }
}
