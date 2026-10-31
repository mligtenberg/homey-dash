using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

namespace HomeyDash.Api.Tests.Realtime;

public sealed class RealtimeHubTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private readonly HttpClient _client = factory.CreateClient();
    private readonly List<HubConnection> _hubs = [];

    // Long polling, because the in-memory test server has no WebSockets for the SignalR client.
    private async Task<HubConnection> ConnectAsync()
    {
        var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "api/realtime"), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        _hubs.Add(hub);
        await hub.StartAsync();
        return hub;
    }

    private static ChannelReader<JsonElement> Listen(HubConnection hub, string method)
    {
        var channel = Channel.CreateUnbounded<JsonElement>();
        hub.On<JsonElement>(method, message => channel.Writer.TryWrite(message));
        return channel.Reader;
    }

    // Reads messages until one matches, so earlier ones that are not about this test are skipped.
    private static async Task<JsonElement> NextAsync(ChannelReader<JsonElement> messages, Func<JsonElement, bool> match)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (true)
        {
            var message = await messages.ReadAsync(timeout.Token);
            if (match(message)) return message;
        }
    }

    private async Task<string> SetUpAsync(Guid screen, string name = "Hallway")
    {
        var response = await _client.PostAsJsonAsync("/api/displays", new { name, screenId = screen });
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    private async Task<string> PublishedDashboardAsync()
    {
        var created = await _client.PostAsJsonAsync("/api/dashboards", new { name = "Kitchen" });
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        await _client.PostAsync($"/api/dashboards/{id}/publish", null);
        return id;
    }

    private Task AssignAsync(string display, string? dashboard, params string[] others) =>
        _client.PutAsJsonAsync($"/api/displays/{display}/dashboard", new { dashboardId = dashboard, otherDashboardIds = others });

    // Each assigned dashboard's latest and shown version, main first, as "latest:shown".
    private static string Shown(JsonElement status) => string.Join(" ", status.GetProperty("versions").EnumerateArray().Select(v =>
        $"{v.GetProperty("latestVersion")}:{(v.GetProperty("shownVersion").ValueKind == JsonValueKind.Null ? "null" : v.GetProperty("shownVersion").ToString())}"));

    private static Func<JsonElement, bool> DisplayWhere(string id, Func<JsonElement, bool> status) => list =>
        list.EnumerateArray().Any(d => d.GetProperty("id").GetString() == id && status(d.GetProperty("status")));

    [Fact]
    public async Task AScreenThatIsNoDisplay_IsSentToSetup()
    {
        var hub = await ConnectAsync();

        Assert.Equal(JsonValueKind.Null, (await hub.InvokeAsync<JsonElement>("JoinScreen", Guid.NewGuid())).ValueKind);
    }

    [Fact]
    public async Task Publishing_SwitchesEveryScreenOfferingTheDashboard()
    {
        var (first, second) = (Guid.NewGuid(), Guid.NewGuid());
        var dashboard = await PublishedDashboardAsync();
        await AssignAsync(await SetUpAsync(first), dashboard);
        await AssignAsync(await SetUpAsync(second), await PublishedDashboardAsync(), dashboard);
        var screens = new List<ChannelReader<JsonElement>>();
        foreach (var screen in new[] { first, second })
        {
            var hub = await ConnectAsync();
            screens.Add(Listen(hub, "Screen"));
            var joined = await hub.InvokeAsync<JsonElement>("JoinScreen", screen);
            Assert.Contains(joined.GetProperty("dashboards").EnumerateArray(), d => d.GetProperty("id").GetString() == dashboard);
        }

        await _client.PutAsJsonAsync($"/api/dashboards/{dashboard}/draft", new { rows = 6, sections = Array.Empty<object>() });
        await _client.PostAsync($"/api/dashboards/{dashboard}/publish", null);

        foreach (var messages in screens)
        {
            var shown = (await NextAsync(messages, _ => true)).GetProperty("dashboards").EnumerateArray()
                .Single(d => d.GetProperty("id").GetString() == dashboard);
            Assert.Equal(2, shown.GetProperty("version").GetInt32());
            Assert.Equal(6, shown.GetProperty("layout").GetProperty("rows").GetInt32());
        }
    }

    [Fact]
    public async Task Takeover_SendsThePreviousScreenToSetup()
    {
        var oldScreen = Guid.NewGuid();
        var display = await SetUpAsync(oldScreen, "Kitchen wall");
        var hub = await ConnectAsync();
        var messages = Listen(hub, "Screen");
        await hub.InvokeAsync<JsonElement>("JoinScreen", oldScreen);

        await _client.PostAsJsonAsync($"/api/displays/{display}/takeover", new { screenId = Guid.NewGuid() });

        await NextAsync(messages, view => view.ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task DisplayStatus_FollowsTheScreen()
    {
        var screen = Guid.NewGuid();
        var display = await SetUpAsync(screen);
        var management = await ConnectAsync();
        var displays = Listen(management, "Displays");
        var listed = await management.InvokeAsync<JsonElement>("JoinManagement");
        Assert.True(DisplayWhere(display, s => !s.GetProperty("connected").GetBoolean())(listed));

        var hub = await ConnectAsync();
        await hub.InvokeAsync<JsonElement>("JoinScreen", screen);
        await NextAsync(displays, DisplayWhere(display, s =>
            s.GetProperty("connected").GetBoolean() && s.GetProperty("lastSeenAt").ValueKind == JsonValueKind.String));

        var (main, other) = (await PublishedDashboardAsync(), await PublishedDashboardAsync());
        await AssignAsync(display, main, other);
        await NextAsync(displays, DisplayWhere(display, s => Shown(s) == "1:null 1:null"));
        await hub.InvokeAsync("Showing", new Dictionary<string, int> { [main] = 1 });
        await NextAsync(displays, DisplayWhere(display, s => Shown(s) == "1:1 1:null"));
        await hub.InvokeAsync("Showing", new Dictionary<string, int> { [main] = 1, [other] = 1 });
        await NextAsync(displays, DisplayWhere(display, s => Shown(s) == "1:1 1:1"));

        await hub.StopAsync();
        await NextAsync(displays, DisplayWhere(display, s => !s.GetProperty("connected").GetBoolean()));
    }

    [Fact]
    public async Task DashboardChanges_ReachManagement()
    {
        var management = await ConnectAsync();
        var dashboards = Listen(management, "Dashboards");
        await management.InvokeAsync<JsonElement>("JoinManagement");
        static Func<JsonElement, bool> Where(string id, Func<JsonElement, bool> match) => list =>
            list.EnumerateArray().Any(d => d.GetProperty("id").GetString() == id && match(d));

        var id = await PublishedDashboardAsync();
        await NextAsync(dashboards, Where(id, d => d.GetProperty("publishedVersion").GetInt32() == 1));

        await _client.PatchAsJsonAsync($"/api/dashboards/{id}", new { name = "Pantry" });
        await NextAsync(dashboards, Where(id, d => d.GetProperty("name").GetString() == "Pantry"));

        await _client.DeleteAsync($"/api/dashboards/{id}");
        await NextAsync(dashboards, list => list.EnumerateArray().All(d => d.GetProperty("id").GetString() != id));
    }

    [Fact]
    public async Task HomeyChanges_ReachEveryConnection()
    {
        var hub = await ConnectAsync();
        var changes = Listen(hub, "DeviceChanged");
        var snapshot = Assert.Single((await hub.InvokeAsync<JsonElement>("Homey")).EnumerateArray());
        Assert.Equal("Fake Homey", snapshot.GetProperty("accountName").GetString());
        var device = snapshot.GetProperty("devices").EnumerateArray()
            .First(d => d.GetProperty("capabilities").TryGetProperty("onoff", out var onoff) && onoff.GetProperty("setable").GetBoolean());
        var on = device.GetProperty("capabilities").GetProperty("onoff").GetProperty("value").GetBoolean();

        await hub.InvokeAsync("SetCapability", null, device.GetProperty("id").GetString(), "onoff", !on);

        await NextAsync(changes, c => c.GetProperty("accountId").GetInt32() == 1 && c.GetProperty("device") is var d
            && d.GetProperty("id").GetString() == device.GetProperty("id").GetString()
            && d.GetProperty("capabilities").GetProperty("onoff").GetProperty("value").GetBoolean() == !on);
    }

    [Fact]
    public async Task AFailedAction_SaysWhy()
    {
        var hub = await ConnectAsync();

        var error = await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("TriggerFlow", 1, "no-such-flow"));
        var account = await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync("ActivateMood", 2, "mood-movie"));
        Assert.Contains("not found", error.Message);
        Assert.Contains("no Homey account 2", account.Message);
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var hub in _hubs) await hub.DisposeAsync();
    }
}
