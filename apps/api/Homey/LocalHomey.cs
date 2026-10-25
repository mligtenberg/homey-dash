using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace HomeyDash.Api.Homey;

/// <summary>
/// The one connection to Homey (ADR-0002): loads a snapshot over the local REST API, then keeps
/// <see cref="HomeyState"/> current from the realtime socket, and reconnects whenever either fails.
/// </summary>
public sealed class LocalHomey(
    IHttpClientFactory httpFactory,
    IOptions<HomeyOptions> options,
    HomeyState state,
    ILogger<LocalHomey> logger) : BackgroundService, IHomey
{
    public const string HttpClientName = "Homey";

    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromSeconds(30);

    private Dictionary<string, string> _zoneNames = [];
    private SocketIoClient? _socket;
    private string _namespace = "/";

    public static TimeSpan FirstRetryDelay { get; set; } = TimeSpan.FromSeconds(1);

    public static void ConfigureHttpClient(HttpClient http, HomeyOptions options)
    {
        http.BaseAddress = new Uri(options.Address!);
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", options.ApiKey);
        http.Timeout = TimeSpan.FromSeconds(10);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var delay = FirstRetryDelay;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                state.SetStatus(HomeyConnection.Connecting, state.Status.LastError);
                await RunSessionAsync(onConnected: () => delay = FirstRetryDelay, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception e)
            {
                logger.LogWarning("Connection to Homey lost: {Error}. Retrying in {Delay}", e.Message, delay);
                state.SetStatus(HomeyConnection.Disconnected, e.Message);
            }

            await Task.Delay(delay, ct);
            delay = TimeSpan.FromTicks(Math.Min(delay.Ticks * 2, MaxRetryDelay.Ticks));
        }
    }

    private async Task RunSessionAsync(Action onConnected, CancellationToken ct)
    {
        var address = new Uri(options.Value.Address!);
        var homeyId = await PingAsync(ct);

        await using var socket = await SocketIoClient.ConnectAsync(address, ct);
        var handshake = await socket.EmitWithAckAsync("/", "handshakeClient",
            [new { token = options.Value.ApiKey, homeyId }], ct);
        ThrowIfError(handshake, "Homey refused the API key");
        _namespace = HomeyMapper.String(handshake[1], "namespace")
            ?? throw new InvalidOperationException("Homey's handshake returned no namespace");
        await socket.ConnectNamespaceAsync(_namespace, ct);

        socket.EventReceived += OnEvent;
        _socket = socket;
        try
        {
            // Subscribe before loading, so nothing that changes in between is missed.
            await Task.WhenAll(new[] { "homey:manager:devices", "homey:manager:flow", "homey:manager:moods" }
                .Select(uri => SubscribeAsync(socket, uri, ct)));
            await LoadSnapshotAsync(ct);
            await Task.WhenAll(state.Devices.Select(d => SubscribeAsync(socket, DeviceUri(d.Id), ct)));

            state.SetStatus(HomeyConnection.Connected);
            onConnected();
            logger.LogInformation("Connected to Homey {HomeyId}: {Devices} devices, {Flows} flows, {Moods} moods",
                homeyId, state.Devices.Count(), state.Flows.Count(), state.Moods.Count());

            await socket.Completion.WaitAsync(ct);
            throw new InvalidOperationException("Homey's realtime connection ended");
        }
        finally
        {
            _socket = null;
            socket.EventReceived -= OnEvent;
        }
    }

    private async Task<string> PingAsync(CancellationToken ct)
    {
        using var response = await Http().GetAsync("api/manager/system/ping", ct);
        response.EnsureSuccessStatusCode();
        return response.Headers.TryGetValues("X-Homey-ID", out var ids)
            ? ids.First()
            : throw new InvalidOperationException($"No Homey found at {options.Value.Address}");
    }

    private async Task LoadSnapshotAsync(CancellationToken ct)
    {
        var zones = GetJsonAsync("api/manager/zones/zone", ct);
        var devices = GetJsonAsync("api/manager/devices/device", ct);
        var flows = GetJsonAsync("api/manager/flow/flow", ct);
        var advancedFlows = GetJsonAsync("api/manager/flow/advancedflow", ct);
        var moods = GetJsonAsync("api/manager/moods/mood", ct);
        await Task.WhenAll(zones, devices, flows, advancedFlows, moods);

        _zoneNames = HomeyMapper.ZoneNames(zones.Result);
        state.Replace(
            HomeyMapper.Values(devices.Result).Select(d => HomeyMapper.Device(d, _zoneNames)),
            HomeyMapper.Values(flows.Result).Select(f => HomeyMapper.Flow(f, advanced: false))
                .Concat(HomeyMapper.Values(advancedFlows.Result).Select(f => HomeyMapper.Flow(f, advanced: true))),
            HomeyMapper.Values(moods.Result).Select(HomeyMapper.Mood));
    }

    private async Task SubscribeAsync(SocketIoClient socket, string uri, CancellationToken ct) =>
        ThrowIfError(await socket.EmitWithAckAsync(_namespace, "subscribe", [uri], ct), $"Homey refused subscribing to {uri}");

    private void OnEvent(string ns, string uri, JsonElement[] args)
    {
        if (ns != _namespace || args is not [{ ValueKind: JsonValueKind.String } eventName, var data, ..]) return;
        var name = eventName.GetString()!;
        try
        {
            HandleEvent(uri, name, data);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Could not handle Homey event {Uri} {Event}", uri, name);
        }
    }

    private void HandleEvent(string uri, string name, JsonElement data)
    {
        logger.LogDebug("Homey event {Uri} {Event}", uri, name);
        switch (uri, name)
        {
            case (_, "capability") when uri.StartsWith("homey:device:"):
                if (HomeyMapper.String(data, "capabilityId") is { } capabilityId && data.TryGetProperty("value", out var value))
                    state.UpdateCapability(uri["homey:device:".Length..], capabilityId, value, HomeyMapper.Date(data, "transactionTime"));
                break;
            case ("homey:manager:devices", "device.create"):
                state.UpsertDevice(HomeyMapper.Device(data, _zoneNames));
                if (_socket is { } socket)
                    _ = SubscribeAsync(socket, DeviceUri(HomeyMapper.String(data, "id")!), CancellationToken.None);
                break;
            case ("homey:manager:devices", "device.update"):
                state.UpsertDevice(HomeyMapper.Device(data, _zoneNames));
                break;
            case ("homey:manager:devices", "device.delete"):
                state.RemoveDevice(HomeyMapper.String(data, "id")!);
                break;
            case ("homey:manager:flow", "flow.create" or "flow.update"):
                state.UpsertFlow(HomeyMapper.Flow(data, advanced: false));
                break;
            case ("homey:manager:flow", "advancedflow.create" or "advancedflow.update"):
                state.UpsertFlow(HomeyMapper.Flow(data, advanced: true));
                break;
            case ("homey:manager:flow", "flow.delete" or "advancedflow.delete"):
                state.RemoveFlow(HomeyMapper.String(data, "id")!);
                break;
            case ("homey:manager:moods", "mood.create" or "mood.update"):
                state.UpsertMood(HomeyMapper.Mood(data));
                break;
            case ("homey:manager:moods", "mood.delete"):
                state.RemoveMood(HomeyMapper.String(data, "id")!);
                break;
        }
    }

    public async Task SetCapabilityValueAsync(string deviceId, string capabilityId, JsonElement value, CancellationToken ct)
    {
        state.RequireSetableCapability(deviceId, capabilityId);
        await SendAsync(HttpMethod.Put,
            $"api/manager/devices/device/{Uri.EscapeDataString(deviceId)}/capability/{Uri.EscapeDataString(capabilityId)}",
            new { value }, ct);
    }

    public async Task TriggerFlowAsync(string flowId, CancellationToken ct)
    {
        var flow = state.FindFlow(flowId) ?? throw new HomeyNotFoundException($"Flow {flowId} not found in Homey");
        var kind = flow.Advanced ? "advancedflow" : "flow";
        await SendAsync(HttpMethod.Post, $"api/manager/flow/{kind}/{Uri.EscapeDataString(flowId)}/trigger", null, ct);
    }

    public async Task ActivateMoodAsync(string moodId, CancellationToken ct)
    {
        if (state.FindMood(moodId) is null) throw new HomeyNotFoundException($"Mood {moodId} not found in Homey");
        await SendAsync(HttpMethod.Post, $"api/manager/moods/mood/{Uri.EscapeDataString(moodId)}/set", null, ct);
    }

    public async Task<IReadOnlyList<HomeyInsightLog>> GetInsightLogsAsync(CancellationToken ct)
    {
        var logs = await GetJsonAsync("api/manager/insights/log", ct);
        return HomeyMapper.Values(logs).Select(HomeyMapper.InsightLog).ToList();
    }

    public async Task<IReadOnlyList<HomeyInsightEntry>> GetInsightEntriesAsync(string logId, string resolution, CancellationToken ct)
    {
        // The log's uri is the first three parts of its id, as in the official client.
        var uri = string.Join(':', logId.Split(':', 4).Take(3));
        var path = $"api/manager/insights/log/{Uri.EscapeDataString(uri)}/{Uri.EscapeDataString(logId)}/entry?resolution={Uri.EscapeDataString(resolution)}";
        try
        {
            using var response = await Http().GetAsync(path, ct);
            if (response.StatusCode == HttpStatusCode.NotFound)
                throw new HomeyNotFoundException($"Insight log {logId} not found in Homey");
            response.EnsureSuccessStatusCode();
            return HomeyMapper.InsightEntries(await response.Content.ReadFromJsonAsync<JsonElement>(ct));
        }
        catch (HttpRequestException e)
        {
            throw new HomeyUnavailableException("Homey cannot be reached", e);
        }
    }

    private HttpClient Http() => httpFactory.CreateClient(HttpClientName);

    private async Task<JsonElement> GetJsonAsync(string path, CancellationToken ct)
    {
        using var response = await Http().GetAsync(path, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>(ct);
    }

    private async Task SendAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        HttpResponseMessage response;
        try
        {
            using var request = new HttpRequestMessage(method, path);
            if (body is not null) request.Content = JsonContent.Create(body);
            response = await Http().SendAsync(request, ct);
        }
        catch (HttpRequestException e)
        {
            throw new HomeyUnavailableException("Homey cannot be reached", e);
        }

        using (response)
        {
            if (response.StatusCode == HttpStatusCode.NotFound)
                throw new HomeyNotFoundException($"Homey does not know {path}");
            if (!response.IsSuccessStatusCode)
                throw new HomeyUnavailableException($"Homey answered {(int)response.StatusCode} to {method} {path}");
        }
    }

    private static string DeviceUri(string deviceId) => $"homey:device:{deviceId}";

    // Homey acknowledges with node-style (error, result) arguments.
    private static void ThrowIfError(JsonElement ack, string message)
    {
        if (ack.ValueKind == JsonValueKind.Array && ack.GetArrayLength() > 0 && ack[0].ValueKind is not JsonValueKind.Null)
            throw new InvalidOperationException($"{message}: {ack[0]}");
    }
}
