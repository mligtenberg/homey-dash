using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using HomeyDash.Api.Homey;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;

namespace HomeyDash.Api.Tests.Homey;

// A stand-in for a Homey Pro on the network: the REST endpoints HomeyDash loads, and the realtime
// socket speaking Engine.IO v3 / Socket.IO v2 the way homey-api's SocketSession expects.
public sealed class ScriptedHomeyServer : IAsyncDisposable
{
    public const string ApiKey = "test-key";
    private const string Namespace = "/api";

    private readonly WebApplication _app;
    private WebSocket? _socket;

    public ConcurrentBag<string> Subscriptions { get; } = [];
    public ConcurrentQueue<(string Method, string Path, string Body)> Requests { get; } = [];
    public Uri Address => new(_app.Urls.First());

    public ScriptedHomeyServer()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        _app = builder.Build();
        _app.UseWebSockets();

        _app.Use(async (context, next) =>
        {
            if (context.Request.Path.StartsWithSegments("/api")
                && context.Request.Headers.Authorization != $"Bearer {ApiKey}")
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
            await next();
        });

        _app.MapGet("/api/manager/system/ping", (HttpResponse response) =>
        {
            response.Headers["X-Homey-ID"] = "homey-1";
            return Results.Ok();
        });
        MapJson("/api/manager/zones/zone", HomeyFixtures.Zones);
        MapJson("/api/manager/devices/device", HomeyFixtures.Devices);
        MapJson("/api/manager/flow/flow", HomeyFixtures.Flows);
        MapJson("/api/manager/flow/advancedflow", HomeyFixtures.AdvancedFlows);
        MapJson("/api/manager/flow/flowfolder", HomeyFixtures.FlowFolders);
        MapJson("/api/manager/moods/mood", HomeyFixtures.Moods);
        MapJson("/api/manager/logic/variable", HomeyFixtures.Variables);
        _app.MapGet("/api/manager/insights/log/{**rest}", (HttpRequest request) =>
        {
            Requests.Enqueue((request.Method, request.Path + request.QueryString, ""));
            return Results.Content("""{"step":300000,"values":[{"t":"2026-10-25T12:05:00.000Z","v":5},{"t":"2026-10-25T12:00:00.000Z","v":4.5},{"t":"2026-10-25T12:10:00.000Z","v":null}]}""", "application/json");
        });
        _app.MapMethods("/api/manager/{**rest}", ["PUT", "POST"], async (HttpRequest request) =>
        {
            using var reader = new StreamReader(request.Body);
            Requests.Enqueue((request.Method, request.Path, await reader.ReadToEndAsync()));
            return Results.Ok();
        });

        _app.Map("/socket.io/", async context =>
        {
            _socket = await context.WebSockets.AcceptWebSocketAsync();
            await RunSocketAsync(_socket);
        });
    }

    public Task StartAsync() => _app.StartAsync();

    // Sends a realtime event for a subscribed URI, as Homey does when something changes.
    public Task PushAsync(string uri, string eventName, object data) =>
        SendAsync(_socket!, "4" + SocketIoPacket.Encode(SocketIoPacketType.Event, Namespace, null, new[] { uri, eventName, data }));

    // Drops the realtime connection, as when Homey restarts.
    public void DropConnection()
    {
        try { _socket?.Abort(); }
        catch (ObjectDisposedException) { } // the connection already ended
    }

    private void MapJson(string path, string json) => _app.MapGet(path, () => Results.Content(json, "application/json"));

    private async Task RunSocketAsync(WebSocket socket)
    {
        await SendAsync(socket, """0{"sid":"s1","upgrades":[],"pingInterval":25000,"pingTimeout":60000}""");
        await SendAsync(socket, "40");

        var buffer = new byte[16 * 1024];
        while (socket.State == WebSocketState.Open)
        {
            WebSocketReceiveResult result;
            try { result = await socket.ReceiveAsync(buffer, CancellationToken.None); }
            catch (WebSocketException) { return; }
            if (result.MessageType == WebSocketMessageType.Close) return;

            var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
            if (text == "2") await SendAsync(socket, "3");
            else if (text[0] == '4') await HandleAsync(socket, SocketIoPacket.Decode(text[1..]));
        }
    }

    private async Task HandleAsync(WebSocket socket, SocketIoPacket packet)
    {
        switch (packet.Type, packet.Namespace)
        {
            case (SocketIoPacketType.Connect, Namespace):
                await SendAsync(socket, "4" + SocketIoPacket.Encode(SocketIoPacketType.Connect, Namespace));
                break;
            case (SocketIoPacketType.Event, "/") when packet.Data!.Value[0].GetString() == "handshakeClient":
                var token = packet.Data.Value[1].GetProperty("token").GetString();
                object?[] ack = token == ApiKey ? [null, new { @namespace = Namespace }] : ["Invalid token"];
                await SendAsync(socket, "4" + SocketIoPacket.Encode(SocketIoPacketType.Ack, "/", packet.AckId, ack));
                break;
            case (SocketIoPacketType.Event, Namespace) when packet.Data!.Value[0].GetString() == "subscribe":
                Subscriptions.Add(packet.Data.Value[1].GetString()!);
                await SendAsync(socket, "4" + SocketIoPacket.Encode(SocketIoPacketType.Ack, Namespace, packet.AckId, new object?[] { null }));
                break;
        }
    }

    private static Task SendAsync(WebSocket socket, string text) =>
        socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, CancellationToken.None);

    public async ValueTask DisposeAsync()
    {
        DropConnection();
        await _app.StopAsync();
        await _app.DisposeAsync();
    }
}
