using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Channels;
using HomeyDash.Api.Homey;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;

namespace HomeyDash.Api.Tests.Rules;

// Rules subscribed over the realtime connection, as a display's logic tiles do (ADR-0010).
public sealed class RuleSubscriptionTests(ClockApiFactory factory) : IClassFixture<ClockApiFactory>, IAsyncLifetime
{
    private readonly HttpClient _client = factory.CreateClient();
    private readonly List<HubConnection> _hubs = [];

    private HomeyState Homey => factory.Services.GetRequiredService<Homeys>().All[0].State;

    // A connection, listening for RuleAnswers.
    private sealed record Connection(HubConnection Hub, ChannelReader<JsonElement> Answers);

    private async Task<Connection> ConnectAsync()
    {
        var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "api/realtime"), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        _hubs.Add(hub);
        var answers = Channel.CreateUnbounded<JsonElement>();
        hub.On<JsonElement>("RuleAnswers", message => answers.Writer.TryWrite(message));
        await hub.StartAsync();
        return new Connection(hub, answers.Reader);
    }

    // A connection of a screen that set up as a new display, with the display's id.
    private async Task<(Connection Connection, string Display)> ScreenAsync(string name)
    {
        var screen = Guid.NewGuid();
        var response = await _client.PostAsJsonAsync("/api/displays", new { name, screenId = screen });
        var display = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        var connection = await ConnectAsync();
        await connection.Hub.InvokeAsync<JsonElement>("JoinScreen", screen);
        return (connection, display);
    }

    private static object Rule(params object[] conditions) => new { match = "all", conditions };

    private static object Any(params object[] conditions) => new { match = "any", conditions };

    private static object When(string signal, string op, object? value = null, bool not = false) =>
        new { signal, @operator = op, value, not };

    private static async Task<bool> SubscribeAsync(Connection connection, string id, object rule, string? asDisplay = null) =>
        (await connection.Hub.InvokeAsync<JsonElement>("SubscribeRule", id, rule, asDisplay is null ? null : Guid.Parse(asDisplay)))
        .GetProperty("holds").GetBoolean();

    // Reads answer messages until one has an answer for this id, and returns that whole message's answers.
    private static async Task<Dictionary<string, bool>> NextAsync(Connection connection, string id)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (true)
        {
            var message = await connection.Answers.ReadAsync(timeout.Token);
            var answers = message.GetProperty("answers").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetBoolean());
            if (answers.ContainsKey(id)) return answers;
        }
    }

    // That no answer for this id arrives for a moment.
    private static async Task NoAnswerAsync(Connection connection, string id)
    {
        await Task.Delay(200);
        while (connection.Answers.TryRead(out var message))
            Assert.False(message.GetProperty("answers").TryGetProperty(id, out _), $"Unexpected answer for {id}: {message}");
    }

    private static string Capability(string device, string capability) => $"homey:1:capability:{device}:{capability}";

    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);

    [Fact]
    public async Task ASubscription_AnswersAtOnce_ThenAsTheHomeChanges()
    {
        var connection = await ConnectAsync();
        var rule = Rule(When(Capability("thermostat", "target_temperature"), "greaterThan", 21));

        Assert.False(await SubscribeAsync(connection, "warm", rule));

        await connection.Hub.InvokeAsync("SetCapability", null, "thermostat", "target_temperature", 22);
        Assert.True((await NextAsync(connection, "warm"))["warm"]);
    }

    [Fact]
    public async Task AnswersChangedByOneChange_ArriveInOneMessage()
    {
        var connection = await ConnectAsync();
        var on = await SubscribeAsync(connection, "on", Rule(When(Capability("living-floor-lamp", "onoff"), "isTrue")));
        Assert.True(await SubscribeAsync(connection, "off", Rule(When(Capability("living-floor-lamp", "onoff"), "isTrue", not: true))) != on);

        await connection.Hub.InvokeAsync("SetCapability", null, "living-floor-lamp", "onoff", !on);

        Assert.Equal(new Dictionary<string, bool> { ["on"] = !on, ["off"] = on }, await NextAsync(connection, "on"));
    }

    [Fact]
    public async Task ARuleFollowsHomeyVariables()
    {
        var connection = await ConnectAsync();
        // A variable of its own, so other tests still see the house mode as Home.
        Homey.UpsertVariable(new HomeyVariable("var-holiday", "Holiday", "string", Json("Home")));
        Assert.False(await SubscribeAsync(connection, "away", Rule(When("homey:1:variable:var-holiday", "equals", "Away"))));

        Homey.UpsertVariable(new HomeyVariable("var-holiday", "Holiday", "string", Json("Away")));

        Assert.True((await NextAsync(connection, "away"))["away"]);
    }

    [Fact]
    public async Task AllOrAny_CombineConditions()
    {
        var connection = await ConnectAsync();
        var guests = When("homey:1:variable:var-guests", "isTrue");
        var home = When("homey:1:variable:var-house-mode", "startsWith", "ho");

        Assert.False(await SubscribeAsync(connection, "all", Rule(guests, home)));
        Assert.True(await SubscribeAsync(connection, "any", Any(guests, home)));
    }

    [Fact]
    public async Task AnUnavailableDevice_KeepsItsLastKnownValue()
    {
        var connection = await ConnectAsync();
        // The star projector is unreachable, and was off.
        Assert.True(await SubscribeAsync(connection, "off", Rule(When(Capability("kids-projector", "onoff"), "isFalse"))));
    }

    [Fact]
    public async Task AConditionOnAMissingSignal_FailsEvenNegated()
    {
        var connection = await ConnectAsync();
        var missing = Rule(When(Capability("no-such-device", "onoff"), "isTrue", not: true));
        Assert.False(await SubscribeAsync(connection, "missing", missing));

        var gone = Rule(When(Capability("garden-heater", "onoff"), "isTrue", not: true));
        Assert.True(await SubscribeAsync(connection, "gone", gone));
        Homey.RemoveDevice("garden-heater");
        Assert.False((await NextAsync(connection, "gone"))["gone"]);
    }

    [Fact]
    public async Task AValueNoLongerAllowed_NeverHolds()
    {
        var connection = await ConnectAsync();
        var alarm = Capability("hall-alarm", "homealarm_state");

        Assert.True(await SubscribeAsync(connection, "disarmed", Rule(When(alarm, "equals", "disarmed"))));
        Assert.False(await SubscribeAsync(connection, "gone", Rule(When(alarm, "equals", "away"))));
        Assert.False(await SubscribeAsync(connection, "not-gone", Rule(When(alarm, "equals", "away", not: true))));
    }

    [Fact]
    public async Task ADisplayNameRule_SurvivesRenamingAndFollowsATakeover()
    {
        var (kitchen, display) = await ScreenAsync("Kitchen");
        var (_, other) = await ScreenAsync("Hallway");
        var rule = Rule(When("display:name", "equals", display));
        Assert.True(await SubscribeAsync(kitchen, "here", rule));
        Assert.False(await SubscribeAsync(kitchen, "there", Rule(When("display:name", "equals", other))));

        await _client.PatchAsJsonAsync($"/api/displays/{display}", new { name = "Kitchen wall" });
        await NoAnswerAsync(kitchen, "here");

        var replacement = Guid.NewGuid();
        await _client.PostAsJsonAsync($"/api/displays/{display}/takeover", new { screenId = replacement });
        var newScreen = await ConnectAsync();
        await newScreen.Hub.InvokeAsync<JsonElement>("JoinScreen", replacement);
        Assert.True(await SubscribeAsync(newScreen, "here", rule));
    }

    [Fact]
    public async Task Management_SeesRulesAsOnTheDisplayItChose()
    {
        var (_, display) = await ScreenAsync("Office");
        var management = await ConnectAsync();
        var rule = Rule(When("display:name", "equals", display));

        Assert.True(await SubscribeAsync(management, "as-office", rule, display));
        Assert.False(await SubscribeAsync(management, "as-none", rule));
        Assert.False(await SubscribeAsync(management, "as-none-negated", Rule(When("display:name", "equals", display, not: true))));
    }

    [Fact]
    public async Task LastTouched_IsTheDisplays_AndExpiresToTheSecond()
    {
        var (screen, _) = await ScreenAsync("Living room");
        var recently = Rule(When("display:touched", "withinLast", new { amount = 30, unit = "seconds" }));
        var idle = Rule(When("display:touched", "longerAgoThan", new { amount = 30, unit = "seconds" }));
        Assert.False(await SubscribeAsync(screen, "recently", recently));
        Assert.True(await SubscribeAsync(screen, "idle", idle));

        await screen.Hub.InvokeAsync("Touched");
        Assert.Equal(new Dictionary<string, bool> { ["recently"] = true, ["idle"] = false }, await NextAsync(screen, "recently"));

        factory.Clock.Advance(TimeSpan.FromSeconds(29));
        await NoAnswerAsync(screen, "recently");
        factory.Clock.Advance(TimeSpan.FromSeconds(1));
        Assert.Equal(new Dictionary<string, bool> { ["recently"] = false, ["idle"] = true }, await NextAsync(screen, "recently"));
    }

    [Fact]
    public async Task ATimeOfDayRule_FlipsAtItsBoundsToTheSecond()
    {
        var connection = await ConnectAsync();
        var now = factory.Clock.GetLocalNow();
        var from = now.AddSeconds(10).ToString("HH:mm:ss");
        var to = now.AddMinutes(1).ToString("HH:mm:ss");
        Assert.False(await SubscribeAsync(connection, "soon", Rule(When("clock:now", "timeOfDayBetween", new { from, to }))));

        factory.Clock.Advance(TimeSpan.FromSeconds(9));
        await NoAnswerAsync(connection, "soon");
        factory.Clock.Advance(TimeSpan.FromSeconds(1));
        Assert.True((await NextAsync(connection, "soon"))["soon"]);
        factory.Clock.Advance(TimeSpan.FromSeconds(50));
        Assert.False((await NextAsync(connection, "soon"))["soon"]);
    }

    [Fact]
    public async Task ATimeOfDayRule_CanWrapMidnight()
    {
        var connection = await ConnectAsync();
        var now = factory.Clock.GetLocalNow();
        var night = new { from = now.AddHours(-1).ToString("HH:mm"), to = now.AddHours(-2).ToString("HH:mm") };

        Assert.True(await SubscribeAsync(connection, "wrapped", Rule(When("clock:now", "timeOfDayBetween", night))));
    }

    [Fact]
    public async Task WeekdayAndDateRules_FollowTheLocalDate()
    {
        var connection = await ConnectAsync();
        var today = factory.Clock.GetLocalNow();
        var tomorrow = today.AddDays(1);
        var weekday = Rule(When("clock:now", "onWeekdays", new[] { tomorrow.DayOfWeek.ToString().ToLowerInvariant() }));
        var dates = Rule(When("clock:now", "dateBetween", new { from = tomorrow.ToString("MM-dd"), to = tomorrow.AddDays(1).ToString("MM-dd") }));
        Assert.False(await SubscribeAsync(connection, "weekday", weekday));
        Assert.False(await SubscribeAsync(connection, "dates", dates));

        factory.Clock.Advance(today.Date.AddDays(1) - today.DateTime);

        Assert.Equal(new Dictionary<string, bool> { ["weekday"] = true, ["dates"] = true }, await NextAsync(connection, "weekday"));
    }

    [Fact]
    public async Task ADeviceTime_CanBeAskedHowLongAgoItWas()
    {
        var connection = await ConnectAsync();
        var motion = "homey:1:changed:living-motion:alarm_motion";
        Homey.UpdateCapability("living-motion", "alarm_motion", Json(true), null);
        Assert.True(await SubscribeAsync(connection, "motion", Rule(When(motion, "withinLast", new { amount = 2, unit = "minutes" }))));

        factory.Clock.Advance(TimeSpan.FromMinutes(2));

        Assert.False((await NextAsync(connection, "motion"))["motion"]);
    }

    [Fact]
    public async Task PlexPlaybackState_IsASignal()
    {
        var connection = await ConnectAsync();
        var paused = Rule(When("plex:1:player:fake-ipad", "equals", "paused"));
        // Plex is polled, so its first answer may come a moment after subscribing.
        if (!await SubscribeAsync(connection, "paused", paused)) Assert.True((await NextAsync(connection, "paused"))["paused"]);
        Assert.True(await SubscribeAsync(connection, "any", Rule(When("plex:1:any", "equals", "playing"))));
    }

    [Fact]
    public async Task AnUnsubscribedRule_IsNoLongerAnswered()
    {
        var connection = await ConnectAsync();
        await SubscribeAsync(connection, "kept", Rule(When(Capability("kitchen-counter", "onoff"), "isTrue")));
        await SubscribeAsync(connection, "dropped", Rule(When(Capability("kitchen-counter", "onoff"), "isFalse")));

        await connection.Hub.InvokeAsync("UnsubscribeRule", "dropped");
        await connection.Hub.InvokeAsync("SetCapability", null, "kitchen-counter", "onoff", true);

        Assert.Equal(new Dictionary<string, bool> { ["kept"] = true }, await NextAsync(connection, "kept"));
    }

    [Fact]
    public async Task AfterReconnecting_SubscribingAgainAnswersWithTheCurrentState()
    {
        var first = await ConnectAsync();
        var rule = Rule(When(Capability("dining-pendant", "onoff"), "isTrue"));
        Assert.False(await SubscribeAsync(first, "lit", rule));
        await first.Hub.StopAsync();

        Homey.UpdateCapability("dining-pendant", "onoff", Json(true), null);

        Assert.True(await SubscribeAsync(await ConnectAsync(), "lit", rule));
    }

    [Fact]
    public async Task AnInvalidRule_IsRefusedWithWhatIsWrong()
    {
        var connection = await ConnectAsync();

        var type = await Assert.ThrowsAsync<HubException>(() =>
            SubscribeAsync(connection, "bad", Rule(When(Capability("thermostat", "target_temperature"), "contains", "2"))));
        var signal = await Assert.ThrowsAsync<HubException>(() => SubscribeAsync(connection, "bad", Rule(When("weather:rain", "isTrue"))));
        var value = await Assert.ThrowsAsync<HubException>(() =>
            SubscribeAsync(connection, "bad", Rule(When(Capability("thermostat", "target_temperature"), "greaterThan", "warm"))));

        Assert.Contains("doesn't suit a number signal", type.Message);
        Assert.Contains("no signal \"weather:rain\"", signal.Message);
        Assert.Contains("needs a number", value.Message);
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var hub in _hubs) await hub.DisposeAsync();
    }
}

// Removing a Homey account changes what its signals are, so this runs on its own API.
public sealed class RuleAccountTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private HubConnection? _hub;

    [Fact]
    public async Task RemovingTheAccount_MakesItsSignalsMissing()
    {
        _ = factory.CreateClient();
        _hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "api/realtime"), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
            })
            .Build();
        var answers = Channel.CreateUnbounded<JsonElement>();
        _hub.On<JsonElement>("RuleAnswers", message => answers.Writer.TryWrite(message));
        await _hub.StartAsync();
        var rule = new { match = "all", conditions = new[] { new { signal = "homey:1:capability:living-tv:onoff", @operator = "isTrue", not = true } } };
        Assert.True((await _hub.InvokeAsync<JsonElement>("SubscribeRule", "tv-off", rule, null)).GetProperty("holds").GetBoolean());

        factory.Services.GetRequiredService<Homeys>().Set([]);

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var message = await answers.Reader.ReadAsync(timeout.Token);
        Assert.False(message.GetProperty("answers").GetProperty("tv-off").GetBoolean());
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (_hub is not null) await _hub.DisposeAsync();
    }
}
