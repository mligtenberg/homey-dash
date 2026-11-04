using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using HomeyDash.Api.Accounts;

namespace HomeyDash.Api.Homey;

/// <summary>
/// The connection to the Homey of one account (ADR-0002): loads a snapshot over the local REST API, then keeps
/// <see cref="HomeyState"/> current from the realtime socket, and reconnects whenever either fails. Runs for as long as
/// <see cref="LocalHomeys"/> keeps the account (ADR-0007) as it is.
/// </summary>
public sealed class LocalHomey(
    IHttpClientFactory httpFactory,
    HomeyAccount account,
    HomeyState state,
    ILogger<LocalHomey> logger) : IHomey
{
    public const string HttpClientName = "Homey";

    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromSeconds(30);

    private SocketIoClient? _socket;
    private string _namespace = "/";

    public static TimeSpan FirstRetryDelay { get; set; } = TimeSpan.FromSeconds(1);

    // Homey doesn't tell when its weather changes, and it changes slowly.
    public static TimeSpan WeatherInterval { get; set; } = TimeSpan.FromMinutes(10);

    public HomeyAccount Account => account;

    public HomeyState State => state;

    private static void ConfigureHttpClient(HttpClient http, HomeyAccount account)
    {
        http.BaseAddress = new Uri(account.Address);
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", account.ApiKey);
        // Actions answer only once Homey has carried them out; a mood that sets many lights takes about 9 s.
        http.Timeout = TimeSpan.FromSeconds(30);
    }

    // Reads answer within milliseconds, so they give up sooner than actions.
    private static readonly TimeSpan ReadTimeout = TimeSpan.FromSeconds(10);

    private static CancellationTokenSource ReadCancellation(CancellationToken ct)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(ReadTimeout);
        return cts;
    }

    // Keeps connected until cancelled.
    public async Task RunAsync(CancellationToken ct)
    {
        try
        {
            await KeepConnectedAsync(ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
        }
    }

    private async Task KeepConnectedAsync(CancellationToken ct)
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
                logger.LogWarning("Connection to Homey {Account} lost: {Error}. Retrying in {Delay}", account.Name, e.Message, delay);
                state.SetStatus(HomeyConnection.Disconnected, e.Message);
            }

            await Task.Delay(delay, ct);
            delay = TimeSpan.FromTicks(Math.Min(delay.Ticks * 2, MaxRetryDelay.Ticks));
        }
    }

    private async Task RunSessionAsync(Action onConnected, CancellationToken ct)
    {
        var address = new Uri(account.Address);
        var homeyId = await PingAsync(ct);

        await using var socket = await SocketIoClient.ConnectAsync(address, ct);
        var handshake = await socket.EmitWithAckAsync("/", "handshakeClient",
            [new { token = account.ApiKey, homeyId }], ct);
        ThrowIfError(handshake, "Homey refused the API key");
        _namespace = HomeyMapper.String(handshake[1], "namespace")
            ?? throw new InvalidOperationException("Homey's handshake returned no namespace");
        await socket.ConnectNamespaceAsync(_namespace, ct);

        socket.EventReceived += OnEvent;
        _socket = socket;
        try
        {
            // Subscribe before loading, so nothing that changes in between is missed.
            await Task.WhenAll(new[] { "homey:manager:devices", "homey:manager:flow", "homey:manager:moods", "homey:manager:zones", "homey:manager:logic" }
                .Select(uri => SubscribeAsync(socket, uri, ct)));
            await SubscribeToImagesAsync(socket, ct);
            await LoadSnapshotAsync(ct);
            await Task.WhenAll(state.Devices.Select(d => SubscribeAsync(socket, DeviceUri(d.Id), ct)));

            state.SetStatus(HomeyConnection.Connected);
            onConnected();
            logger.LogInformation("Connected to Homey {Account} ({HomeyId}): {Devices} devices, {Flows} flows, {Moods} moods",
                account.Name, homeyId, state.Devices.Count(), state.Flows.Count(), state.Moods.Count());

            using var session = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var weather = FollowWeatherAsync(session.Token);
            try
            {
                await socket.Completion.WaitAsync(ct);
            }
            finally
            {
                await session.CancelAsync();
                await weather;
            }
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
            : throw new InvalidOperationException($"No Homey found at {account.Address}");
    }

    private async Task LoadSnapshotAsync(CancellationToken ct)
    {
        var zones = GetJsonAsync("api/manager/zones/zone", ct);
        var devices = GetJsonAsync("api/manager/devices/device", ct);
        var flows = GetJsonAsync("api/manager/flow/flow", ct);
        var advancedFlows = GetJsonAsync("api/manager/flow/advancedflow", ct);
        var flowFolders = GetJsonAsync("api/manager/flow/flowfolder", ct);
        var moods = GetJsonAsync("api/manager/moods/mood", ct);
        var variables = GetVariablesAsync(ct);
        await Task.WhenAll(zones, devices, flows, advancedFlows, flowFolders, moods, variables);

        var zoneList = HomeyMapper.Values(zones.Result).Select(HomeyMapper.Zone).ToList();
        var zoneNames = zoneList.ToDictionary(z => z.Id, z => z.Name);
        state.Replace(
            HomeyMapper.Values(devices.Result).Select(d => HomeyMapper.Device(d, zoneNames)),
            HomeyMapper.Values(flows.Result).Select(f => HomeyMapper.Flow(f, advanced: false))
                .Concat(HomeyMapper.Values(advancedFlows.Result).Select(f => HomeyMapper.Flow(f, advanced: true))),
            HomeyMapper.Values(moods.Result).Select(HomeyMapper.Mood),
            zoneList,
            HomeyMapper.Values(flowFolders.Result).Select(HomeyMapper.FlowFolder),
            variables.Result);
    }

    // Variables only feed rules, so an API key that may not read them leaves them out rather than failing.
    private async Task<List<HomeyVariable>> GetVariablesAsync(CancellationToken ct)
    {
        try
        {
            return HomeyMapper.Values(await GetJsonAsync("api/manager/logic/variable", ct)).Select(HomeyMapper.Variable).ToList();
        }
        catch (HttpRequestException e)
        {
            logger.LogWarning("Could not read the variables of Homey {Account}: {Error}", account.Name, e.Message);
            return [];
        }
    }

    // Reads Homey's own weather now and every while, for as long as the session lasts. An API key that may not read it
    // (it needs the geolocation scope) leaves it out rather than failing; so does a Homey that can't tell.
    private async Task FollowWeatherAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                state.SetWeather(HomeyMapper.Weather(await GetJsonAsync("api/manager/weather/weather", ct)));
            }
            catch (HttpRequestException e) when (e.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized or HttpStatusCode.NotFound)
            {
                logger.LogWarning("Homey {Account} won't tell its weather: {Error}", account.Name, e.Message);
                return;
            }
            catch (Exception e) when (e is HttpRequestException or JsonException || e is OperationCanceledException && !ct.IsCancellationRequested)
            {
                logger.LogDebug("Could not read the weather of Homey {Account}: {Error}", account.Name, e.Message);
            }
            try
            {
                await Task.Delay(WeatherInterval, ct);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private async Task SubscribeAsync(SocketIoClient socket, string uri, CancellationToken ct) =>
        ThrowIfError(await socket.EmitWithAckAsync(_namespace, "subscribe", [uri], ct), $"Homey refused subscribing to {uri}");

    // Album art only adds to a speaker's tile, so a Homey that won't tell when pictures change still connects.
    private async Task SubscribeToImagesAsync(SocketIoClient socket, CancellationToken ct)
    {
        try
        {
            await SubscribeAsync(socket, "homey:manager:images", ct);
        }
        catch (InvalidOperationException e)
        {
            logger.LogWarning("Album art of Homey {Account} won't follow the music: {Error}", account.Name, e.Message);
        }
    }

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
                state.UpsertDevice(HomeyMapper.Device(data, ZoneNames()));
                if (_socket is { } socket)
                    _ = SubscribeAsync(socket, DeviceUri(HomeyMapper.String(data, "id")!), CancellationToken.None);
                break;
            case ("homey:manager:devices", "device.update"):
                state.UpsertDevice(HomeyMapper.Device(data, ZoneNames()));
                break;
            case ("homey:manager:devices", "device.delete"):
                state.RemoveDevice(HomeyMapper.String(data, "id")!);
                break;
            case ("homey:manager:images", "image.update"):
                if (HomeyMapper.String(data, "id") is { } imageId)
                    state.UpdateImage(imageId, HomeyMapper.ImageVersion(data));
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
            case ("homey:manager:flow", "flowfolder.create" or "flowfolder.update"):
                state.UpsertFlowFolder(HomeyMapper.FlowFolder(data));
                break;
            case ("homey:manager:flow", "flowfolder.delete"):
                state.RemoveFlowFolder(HomeyMapper.String(data, "id")!);
                break;
            case ("homey:manager:moods", "mood.create" or "mood.update"):
                state.UpsertMood(HomeyMapper.Mood(data));
                break;
            case ("homey:manager:moods", "mood.delete"):
                state.RemoveMood(HomeyMapper.String(data, "id")!);
                break;
            case ("homey:manager:zones", "zone.create" or "zone.update"):
                state.UpsertZone(HomeyMapper.Zone(data));
                break;
            case ("homey:manager:zones", "zone.delete"):
                state.RemoveZone(HomeyMapper.String(data, "id")!);
                break;
            case ("homey:manager:logic", "variable.create" or "variable.update"):
                state.UpsertVariable(HomeyMapper.Variable(data));
                break;
            case ("homey:manager:logic", "variable.delete"):
                state.RemoveVariable(HomeyMapper.String(data, "id")!);
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
            using var read = ReadCancellation(ct);
            using var response = await Http().GetAsync(path, read.Token);
            if (response.StatusCode == HttpStatusCode.NotFound)
                throw new HomeyNotFoundException($"Insight log {logId} not found in Homey");
            response.EnsureSuccessStatusCode();
            return HomeyMapper.InsightEntries(await response.Content.ReadFromJsonAsync<JsonElement>(read.Token));
        }
        catch (HttpRequestException e)
        {
            throw new HomeyUnavailableException("Homey cannot be reached", e);
        }
    }

    public async Task<(byte[] Content, string ContentType)?> GetImageAsync(string imageId, CancellationToken ct)
    {
        try
        {
            using var read = ReadCancellation(ct);
            using var response = await Http().GetAsync($"api/image/{Uri.EscapeDataString(imageId)}", read.Token);
            if (response.StatusCode == HttpStatusCode.NotFound) return null;
            response.EnsureSuccessStatusCode();
            return (await response.Content.ReadAsByteArrayAsync(read.Token), response.Content.Headers.ContentType?.MediaType ?? "image/jpeg");
        }
        catch (HttpRequestException e)
        {
            throw new HomeyUnavailableException("Homey cannot be reached", e);
        }
    }

    private HttpClient Http()
    {
        var http = httpFactory.CreateClient(HttpClientName);
        ConfigureHttpClient(http, account);
        return http;
    }

    private async Task<JsonElement> GetJsonAsync(string path, CancellationToken ct)
    {
        using var read = ReadCancellation(ct);
        using var response = await Http().GetAsync(path, read.Token);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>(read.Token);
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

    private Dictionary<string, string> ZoneNames() => state.Zones.ToDictionary(z => z.Id, z => z.Name);

    private static string DeviceUri(string deviceId) => $"homey:device:{deviceId}";

    // Homey acknowledges with node-style (error, result) arguments.
    private static void ThrowIfError(JsonElement ack, string message)
    {
        if (ack.ValueKind == JsonValueKind.Array && ack.GetArrayLength() > 0 && ack[0].ValueKind is not JsonValueKind.Null)
            throw new InvalidOperationException($"{message}: {ack[0]}");
    }
}
