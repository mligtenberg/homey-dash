using System.Text.Json;
using HomeyDash.Api.Accounts;

namespace HomeyDash.Api.Homey;

// A Homey with a realistic family home (two floors, an attic, a garden and a garage, with the devices, flows and
// moods such a home has), used when the configuration sets Homey:Fake. Tests rely on living-lamp, thermostat,
// front-door, washer, p1-meter, living-motion, hall-alarm, flow-goodnight, mood-movie, mood-dinner, var-house-mode
// and var-guests; keep those.
public sealed class FakeHomey(Homeys homeys, TimeProvider time) : IHostedService, IHomey
{
    // Its one account, which can't be changed.
    public static readonly HomeyAccount Account = new("http://fake-homey", "fake") { Id = 1, Name = "Fake Homey" };

    private readonly HomeyState _state = new(time, Account.Id);

    public HomeyState State => _state;

    private static readonly JsonElement True = JsonSerializer.SerializeToElement(true);
    private static readonly JsonElement False = JsonSerializer.SerializeToElement(false);
    private static readonly JsonElement Null = JsonSerializer.SerializeToElement<object?>(null);

    private static readonly HomeyZone[] Zones =
    [
        new("home", "Home", null),
        new("ground", "Ground floor", "home"),
        new("living", "Living room", "ground"),
        new("kitchen", "Kitchen", "ground"),
        new("dining", "Dining room", "ground"),
        new("hall", "Hall", "ground"),
        new("toilet", "Toilet", "ground"),
        new("first", "First floor", "home"),
        new("bedroom", "Bedroom", "first"),
        new("kids", "Noah's room", "first"),
        new("office", "Office", "first"),
        new("bathroom", "Bathroom", "first"),
        new("landing", "Landing", "first"),
        new("attic", "Attic", "home"),
        new("utility", "Utility room", "attic"),
        new("outside", "Outside", "home"),
        new("garden", "Garden", "outside"),
        new("garage", "Garage", "outside"),
    ];

    private static readonly HomeyDevice[] Devices =
    [
        // Living room
        Device("living-lamp", "Reading lamp", "living", "light", OnOff(true), Dim(0.8)),
        Device("living-ceiling", "Ceiling light", "living", "light", OnOff(false), Dim(1)),
        Device("living-floor-lamp", "Floor lamp", "living", "light", OnOff(true)),
        Device("living-tv-bars", "TV light bars", "living", "light", OnOff(false), Dim(0.4)),
        Device("thermostat", "Thermostat", "living", "thermostat", Target(20.5), Temperature(20.1)),
        Device("living-blinds", "Blinds", "living", "blinds", Cover("idle")),
        Device("living-tv", "TV", "living", "tv", OnOff(false),
            Number("volume_set", "Volume", 0.3, null, true, 0, 1, 0.01),
            Capability("volume_mute", "Mute", "boolean", False, true),
            Button("channel_up", "Channel up"), Button("channel_down", "Channel down")),
        Device("living-xbox", "Xbox", "living", "gameconsole",
            OnOff(false),
            Button("controller_Up", "Up"), Button("controller_Down", "Down"), Button("controller_Left", "Left"), Button("controller_Right", "Right"),
            Button("controller_A", "A"), Button("controller_B", "B"), Button("controller_X", "X"), Button("controller_Y", "Y"),
            Button("controller_Menu", "Menu"), Button("controller_View", "View"), Button("controller_nexus", "Xbox")),
        Device("living-speaker", "Speaker", "living", "speaker",
            Capability("speaker_playing", "Playing", "boolean", True, true),
            Capability("speaker_track", "Track", "string", JsonSerializer.SerializeToElement("Birds of a Feather"), false),
            Capability("speaker_artist", "Artist", "string", JsonSerializer.SerializeToElement("Billie Eilish"), false),
            Capability("speaker_album", "Album", "string", JsonSerializer.SerializeToElement("Hit Me Hard and Soft"), false),
            Number("volume_set", "Volume", 0.25, null, true, 0, 1, 0.01),
            Group("Living room")) with { AlbumArt = new("fake-album-art", "1") },
        Device("living-apple-tv", "Apple TV", "living", "settopbox",
            OnOff(true),
            Capability("speaker_playing", "Playing", "boolean", True, true),
            Capability("speaker_track", "Track", "string", JsonSerializer.SerializeToElement("Got Talent"), false),
            Capability("speaker_artist", "Artist", "string", JsonSerializer.SerializeToElement("Videoland"), false),
            Capability("now_playing_app", "App", "string", JsonSerializer.SerializeToElement("Videoland"), false),
            Number("speaker_duration", "Length", 5516.92, null, false), Number("speaker_position", "Position", 1125.2, null, false),
            Button("remote_up", "Up"), Button("remote_down", "Down"), Button("remote_left", "Left"), Button("remote_right", "Right"),
            Button("remote_select", "Select"), Button("remote_back", "Back"), Button("remote_home", "Home"),
            Button("volume_down", "Volume down"), Button("volume_mute", "Mute"), Button("volume_up", "Volume up")),
        Device("living-vacuum", "Robot vacuum", "living", "vacuumcleaner", OnOff(false), Number("measure_battery", "Battery", 87, "%", false)),
        Device("living-climate", "Climate sensor", "living", "sensor", Temperature(20.3), Humidity(48)),
        Device("living-motion", "Motion sensor", "living", "sensor", Alarm("alarm_motion", "Motion", false), Number("measure_luminance", "Light level", 140, "lx", false)),

        // Kitchen
        Device("kitchen-speaker", "Kitchen speaker", "kitchen", "speaker",
            Capability("speaker_playing", "Playing", "boolean", False, true),
            Capability("speaker_track", "Track", "string", JsonSerializer.SerializeToElement("Birds of a Feather"), false),
            Capability("speaker_artist", "Artist", "string", JsonSerializer.SerializeToElement("Billie Eilish"), false),
            Number("volume_set", "Volume", 0.35, null, true, 0, 1, 0.01),
            Group("Kitchen")),
        Device("kitchen-spots", "Kitchen spots", "kitchen", "light", OnOff(true), Dim(0.6)),
        Device("kitchen-counter", "Counter lights", "kitchen", "light", OnOff(false)),
        Device("kitchen-dishwasher", "Dishwasher", "kitchen", "dishwasher", OnOff(true), Power(1950)),
        Device("kitchen-coffee", "Coffee machine", "kitchen", "coffeemachine", OnOff(false)),
        Device("kitchen-fridge", "Fridge plug", "kitchen", "socket", OnOff(true), Power(84)),
        Device("kitchen-smoke", "Smoke detector", "kitchen", "sensor", Alarm("alarm_smoke", "Smoke", false), Number("measure_battery", "Battery", 64, "%", false)),

        // Dining room
        Device("dining-pendant", "Dining pendant", "dining", "light", OnOff(false), Dim(0.7)),
        Device("dining-radiator", "Radiator", "dining", "thermostat", Target(20), Temperature(19.6)),
        Device("dining-garden-door", "Garden door", "dining", "sensor", Alarm("alarm_contact", "Open", false)),

        // Hall and toilet
        Device("front-door", "Front door", "hall", "lock", Capability("locked", "Locked", "boolean", True, true)),
        Device("hall-light", "Hall light", "hall", "light", OnOff(false)),
        Device("hall-doorbell", "Doorbell", "hall", "doorbell", Alarm("alarm_generic", "Ringing", false)),
        Device("hall-alarm", "Alarm system", "hall", "homealarm",
            Capability("homealarm_state", "Alarm", "enum", JsonSerializer.SerializeToElement("disarmed"), true) with
            {
                Values = [new("armed", "Armed"), new("disarmed", "Disarmed"), new("partially_armed", "Partially armed")],
            }),
        Device("toilet-light", "Toilet light", "toilet", "light", OnOff(false)),
        Device("toilet-motion", "Toilet motion sensor", "toilet", "sensor", Alarm("alarm_motion", "Motion", false)),

        // Bedroom
        Device("bedroom-ceiling", "Ceiling light", "bedroom", "light", OnOff(false), Dim(1)),
        Device("bedroom-bedside-left", "Bedside lamp left", "bedroom", "light", OnOff(false), Dim(0.3)),
        Device("bedroom-bedside-right", "Bedside lamp right", "bedroom", "light", OnOff(false), Dim(0.3)),
        Device("bedroom-curtains", "Curtains", "bedroom", "curtain", Cover("idle")),
        Device("bedroom-radiator", "Radiator", "bedroom", "thermostat", Target(17), Temperature(17.4)),
        Device("bedroom-climate", "Climate sensor", "bedroom", "sensor", Temperature(17.6), Humidity(55)),

        // Noah's room
        Device("kids-ceiling", "Ceiling light", "kids", "light", OnOff(false), Dim(1)),
        Device("kids-night-light", "Night light", "kids", "light", OnOff(true), Dim(0.1)),
        Device("kids-radiator", "Radiator", "kids", "thermostat", Target(18.5), Temperature(18.2)),
        Unavailable(Device("kids-projector", "Star projector", "kids", "socket", OnOff(false)), "Device is unreachable"),

        // Office
        Device("office-desk-lamp", "Desk lamp", "office", "light", OnOff(true), Dim(0.9)),
        Device("office-desk", "Desk socket", "office", "socket", OnOff(true), Power(212)),
        Device("office-radiator", "Radiator", "office", "thermostat", Target(21), Temperature(20.8)),
        Device("office-purifier", "Air purifier", "office", "airpurifier", OnOff(true)),
        Device("office-climate", "Climate sensor", "office", "sensor", Temperature(21.2), Humidity(42), Number("measure_co2", "CO₂", 870, "ppm", false)),

        // Bathroom and landing
        Device("bathroom-mirror", "Mirror light", "bathroom", "light", OnOff(false)),
        Device("bathroom-towel-heater", "Towel heater", "bathroom", "heater", OnOff(false), Power(0)),
        Device("bathroom-fan", "Ventilation", "bathroom", "fan", OnOff(false)),
        Device("bathroom-humidity", "Humidity sensor", "bathroom", "sensor", Temperature(21.9), Humidity(71)),
        Device("landing-light", "Landing light", "landing", "light", OnOff(false), Dim(0.5)),
        Device("landing-smoke", "Smoke detector", "landing", "sensor", Alarm("alarm_smoke", "Smoke", false), Number("measure_battery", "Battery", 91, "%", false)),

        // Utility room
        Device("washer", "Washing machine", "utility", "washer", OnOff(false), Power(0)),
        Device("utility-dryer", "Dryer", "utility", "dryer", OnOff(false), Power(0)),
        Device("utility-boiler", "Boiler", "utility", "boiler", OnOff(true), Number("measure_temperature", "Water temperature", 58, "°C", false)),
        Device("p1-meter", "Energy meter", "utility", "sensor", Power(1840),
            Number("meter_power", "Energy", 18423.6, "kWh", false), Number("meter_gas", "Gas", 7312.4, "m³", false)),

        // Garden and garage
        Device("garden-lights", "Garden lights", "garden", "light", OnOff(false)),
        Device("garden-heater", "Terrace heater", "garden", "heater", OnOff(false)),
        Device("garden-sunshade", "Sunshade", "garden", "sunshade", Cover("up")),
        Device("garden-weather", "Weather station", "garden", "sensor", Temperature(11.4), Humidity(78),
            Number("measure_wind_strength", "Wind", 14, "km/h", false)),
        Device("garden-solar", "Solar panels", "garden", "solarpanel", Power(2350), Number("meter_power", "Energy", 9120.2, "kWh", false)),
        Device("garage-door", "Garage door", "garage", "garagedoor", Capability("garagedoor_closed", "Closed", "boolean", True, true)),
        Device("garage-charger", "EV charger", "garage", "evcharger", OnOff(false), Power(0)),
        Unavailable(Device("garage-camera", "Driveway camera", "garage", "camera", Alarm("alarm_motion", "Motion", false)), "Lost its Wi-Fi connection"),
    ];

    // House modes as Homey Logic variables, for rules to follow.
    private static readonly HomeyVariable[] Variables =
    [
        new("var-house-mode", "House mode", "string", JsonSerializer.SerializeToElement("Home")),
        new("var-guests", "Guests", "boolean", False),
        new("var-night", "Night", "boolean", False),
        new("var-energy-price", "Energy price", "number", JsonSerializer.SerializeToElement(0.24)),
    ];

    private static readonly HomeyFlowFolder[] FlowFolders =
    [
        new("folder-morning", "Morning", null),
        new("folder-evening", "Evening", null),
        new("folder-security", "Away & security", null),
        new("folder-climate", "Climate", null),
        new("folder-energy", "Energy", null),
        new("folder-notifications", "Notifications", "folder-security"),
    ];

    private static readonly HomeyFlow[] Flows =
    [
        new("flow-wake-up", "Wake up", Advanced: false, Enabled: true, FolderId: "folder-morning"),
        new("flow-weekday-morning", "Weekday morning", Advanced: true, Enabled: true, FolderId: "folder-morning"),
        new("flow-coffee", "Start coffee", Advanced: false, Enabled: true, FolderId: "folder-morning"),
        new("flow-school-run", "School run", Advanced: false, Enabled: false, FolderId: "folder-morning"),
        new("flow-goodnight", "Good night", Advanced: false, Enabled: true, FolderId: "folder-evening"),
        new("flow-sunset", "Lights on at sunset", Advanced: false, Enabled: true, FolderId: "folder-evening"),
        new("flow-kids-bedtime", "Kids' bedtime", Advanced: true, Enabled: true, FolderId: "folder-evening"),
        new("flow-close-blinds", "Close all blinds", Advanced: false, Enabled: true, FolderId: "folder-evening"),
        new("flow-leave", "Leaving home", Advanced: true, Enabled: true, FolderId: null),
        new("flow-arrive", "Coming home", Advanced: true, Enabled: true, FolderId: null),
        new("flow-vacation", "Vacation mode", Advanced: true, Enabled: false, FolderId: "folder-security"),
        new("flow-arm-night", "Arm alarm for the night", Advanced: false, Enabled: true, FolderId: "folder-security"),
        new("flow-lock-up", "Lock up", Advanced: false, Enabled: true, FolderId: "folder-security"),
        new("flow-doorbell", "Doorbell pressed", Advanced: false, Enabled: true, FolderId: "folder-notifications"),
        new("flow-smoke", "Smoke detected", Advanced: true, Enabled: true, FolderId: "folder-notifications"),
        new("flow-washer-done", "Washing done", Advanced: false, Enabled: true, FolderId: "folder-notifications"),
        new("flow-boost-heating", "Boost heating", Advanced: false, Enabled: true, FolderId: "folder-climate"),
        new("flow-eco-heating", "Eco heating", Advanced: false, Enabled: true, FolderId: "folder-climate"),
        new("flow-shower-fan", "Fan after shower", Advanced: false, Enabled: true, FolderId: "folder-climate"),
        new("flow-air-quality", "Purify when CO₂ is high", Advanced: true, Enabled: true, FolderId: "folder-climate"),
        new("flow-charge-solar", "Charge car on solar", Advanced: true, Enabled: true, FolderId: "folder-energy"),
        new("flow-cheap-hours", "Run appliances in cheap hours", Advanced: true, Enabled: false, FolderId: "folder-energy"),
        new("flow-standby-off", "Turn off standby devices", Advanced: false, Enabled: true, FolderId: "folder-energy"),
        new("flow-vacuum", "Vacuum the living room", Advanced: false, Enabled: true, FolderId: null),
    ];

    private static readonly HomeyMood[] Moods =
    [
        Mood("mood-movie", "Movie night", "living", Color(.66, .9), Color(.75, .7), White(1)),
        Mood("mood-reading", "Reading", "living", White(.4), White(.5)),
        Mood("mood-cosy", "Cosy evening", "living", White(1), Color(.08, .8), White(.9)),
        Mood("mood-bright", "Bright", "living", White(.2), White(.2), White(.3)),
        Mood("mood-gaming", "Gaming", "living", Color(.83, 1), Color(.5, 1), Color(.6, 1)),
        Mood("mood-dinner", "Dinner", "dining", White(.85), Color(.06, .6)),
        Mood("mood-candlelight", "Candlelight", "dining", Color(.07, 1), White(1)),
        Mood("mood-cooking", "Cooking", "kitchen", White(.3), White(.35)),
        Mood("mood-breakfast", "Breakfast", "kitchen", White(.6), Color(.13, .5)),
        Mood("mood-wake-up", "Wake up", "bedroom", Color(.1, .7), White(.7)),
        Mood("mood-bedtime", "Bedtime", "bedroom", White(1), Color(.03, .9)),
        Mood("mood-night", "Night light", "bedroom", Color(.03, 1)),
        Mood("mood-story-time", "Story time", "kids", Color(.12, .8), Color(.92, .5)),
        Mood("mood-sleep", "Sleep", "kids", Color(.7, .8)),
        Mood("mood-focus", "Focus", "office", White(0), White(.1)),
        Mood("mood-video-call", "Video call", "office", White(.45), White(.5)),
        Mood("mood-bath", "Relaxing bath", "bathroom", Color(.55, .7), Color(.45, .6), White(1)),
        Mood("mood-garden-party", "Garden party", "garden", Color(.0, 1), Color(.15, 1), Color(.33, 1), Color(.6, 1)),
        Mood("mood-all-off", "All off", "home"),
    ];

    private static HomeyMood Mood(string id, string name, string zoneId, params HomeyLightColor[] colors) =>
        new(id, name, zoneId, colors);

    private static HomeyLightColor Color(double hue, double saturation) => new(hue, saturation, null);

    private static HomeyLightColor White(double temperature) => new(null, null, temperature);


    // Every reading a device has, plus one of Homey's own.
    private static readonly HomeyInsightLog[] InsightLogs =
    [
        .. Devices.SelectMany(d => d.Capabilities.Values
            .Where(c => c.Type == "number" && (c.Id.StartsWith("measure_") || c.Id.StartsWith("meter_")))
            .Select(c => new HomeyInsightLog($"homey:device:{d.Id}:{c.Id}", $"homey:device:{d.Id}", d.Name, c.Title, "number", c.Units))),
        new("homey:manager:weather:temperature", "homey:manager:weather", "Weather", "Temperature", "number", "°C"),
    ];

    public Task StartAsync(CancellationToken ct)
    {
        _state.Replace(Devices, Flows, Moods, Zones, FlowFolders, Variables);
        _state.SetWeather(new HomeyWeather(13.2, "Clouds", 0.81, "Utrecht"));
        _state.SetStatus(HomeyConnection.Connected, fake: true);
        homeys.Set([new Homeys.Entry(Account.Id, Account.Name, this)]);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;

    public Task SetCapabilityValueAsync(string deviceId, string capabilityId, JsonElement value, CancellationToken ct)
    {
        _state.RequireSetableCapability(deviceId, capabilityId);
        _state.UpdateCapability(deviceId, capabilityId, value, null);
        return Task.CompletedTask;
    }

    public Task JoinSpeakerGroupAsync(string deviceId, string withDeviceId, CancellationToken ct)
    {
        var group = GroupOf(withDeviceId);
        _state.UpdateCapability(deviceId, "sonos_group", JsonSerializer.SerializeToElement(group), null);
        return Task.CompletedTask;
    }

    public Task LeaveSpeakerGroupAsync(string deviceId, CancellationToken ct)
    {
        var name = _state.FindDevice(deviceId)?.Name ?? throw new HomeyNotFoundException($"Device {deviceId} not found in Homey");
        _state.UpdateCapability(deviceId, "sonos_group", JsonSerializer.SerializeToElement(name), null);
        return Task.CompletedTask;
    }

    public Task SetGroupVolumeAsync(string deviceId, int volume, CancellationToken ct)
    {
        if (volume is < 1 or > 100) throw new ArgumentException("Group volume is between 1 and 100");
        var group = GroupOf(deviceId);
        foreach (var member in _state.Devices.Where(d => d.Capabilities.TryGetValue("sonos_group", out var g) && g.Value.ToString() == group))
            _state.UpdateCapability(member.Id, "volume_set", JsonSerializer.SerializeToElement(volume / 100.0), null);
        return Task.CompletedTask;
    }

    private static readonly Dictionary<string, string[]> Music = new()
    {
        [SpeakerMusicKinds.Favorite] = ["Morning radio", "Dinner jazz", "Kids' songs"],
        [SpeakerMusicKinds.Playlist] = ["Chill", "Workout", "Road trip"],
    };

    public Task<IReadOnlyList<SpeakerMusic>> ListSpeakerMusicAsync(string deviceId, string kind, CancellationToken ct)
    {
        GroupOf(deviceId);
        return Music.TryGetValue(kind, out var names)
            ? Task.FromResult<IReadOnlyList<SpeakerMusic>>(names.Select(n => new SpeakerMusic(n, kind == SpeakerMusicKinds.Favorite ? "Sonos Radio" : "Apple Music", MusicCover(n), JsonSerializer.SerializeToElement(new { name = n }))).ToList())
            : throw new ArgumentException($"Unknown kind of music {kind}; use favorite or playlist");
    }

    // A plain coloured cover per name, so the picker has something to show.
    private static string MusicCover(string name)
    {
        var hue = Math.Abs(name.Aggregate(7, (h, c) => h * 31 + c)) % 360;
        return $"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 4'%3E%3Crect width='4' height='4' fill='hsl({hue} 55% 45%)'/%3E%3C/svg%3E";
    }

    public Task PlaySpeakerMusicAsync(string deviceId, string kind, JsonElement item, CancellationToken ct)
    {
        var group = GroupOf(deviceId);
        var name = item.TryGetProperty("name", out var n) ? n.GetString() : null;
        if (name is null || !Music.GetValueOrDefault(kind, []).Contains(name)) throw new HomeyNotFoundException($"Sonos does not know {name ?? "that"}");
        foreach (var member in _state.Devices.Where(d => d.Capabilities.TryGetValue("sonos_group", out var g) && g.Value.ToString() == group))
        {
            _state.UpdateCapability(member.Id, "speaker_playing", JsonSerializer.SerializeToElement(true), null);
            _state.UpdateCapability(member.Id, "speaker_track", JsonSerializer.SerializeToElement(name), null);
        }
        return Task.CompletedTask;
    }

    private static readonly (string Name, string Category)[] Apps =
    [
        ("Netflix", "Entertainment"), ("Disney+", "Entertainment"), ("YouTube", "Photo & Video"), ("Videoland", "Entertainment"),
        ("NPO", "Entertainment"), ("Plex", "Photo & Video"), ("Spotify", "Music"), ("Prime Video", "Entertainment"), ("Settings", "Apple"),
    ];
    private static readonly string[] AppNames = [.. Apps.Select(a => a.Name)];

    public Task<IReadOnlyList<DeviceApp>> ListDeviceAppsAsync(string deviceId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<DeviceApp>>(HasApps(deviceId)
            ? Apps.Select(a => new DeviceApp(a.Name, null, JsonSerializer.SerializeToElement(new { name = a.Name, id = a.Name == "Settings" ? "com.apple.TVSettings" : (string?)null })) { Category = a.Category, Media = a.Category != "Apple" }).ToList()
            : []);

    public Task OpenDeviceAppAsync(string deviceId, JsonElement item, CancellationToken ct)
    {
        var name = item.TryGetProperty("name", out var n) ? n.GetString() : null;
        if (!HasApps(deviceId) || name is null || !AppNames.Contains(name)) throw new HomeyNotFoundException($"{name ?? "That app"} cannot be opened");
        _state.UpdateCapability(deviceId, "now_playing_app", JsonSerializer.SerializeToElement(name), null);
        _state.UpdateCapability(deviceId, "speaker_track", JsonSerializer.SerializeToElement(name), null);
        return Task.CompletedTask;
    }

    private bool HasApps(string deviceId) =>
        _state.FindDevice(deviceId) is { } device ? device.Capabilities.ContainsKey("now_playing_app") : throw new HomeyNotFoundException($"Device {deviceId} not found in Homey");

    private string GroupOf(string deviceId) =>
        _state.FindDevice(deviceId)?.Capabilities.GetValueOrDefault("sonos_group")?.Value.GetString()
        ?? throw new HomeyNotFoundException($"Device {deviceId} is not a Sonos speaker");

    public Task TriggerFlowAsync(string flowId, CancellationToken ct) =>
        _state.FindFlow(flowId) is null
            ? throw new HomeyNotFoundException($"Flow {flowId} not found in Homey")
            : Task.CompletedTask;

    public Task ActivateMoodAsync(string moodId, CancellationToken ct) =>
        _state.FindMood(moodId) is null
            ? throw new HomeyNotFoundException($"Mood {moodId} not found in Homey")
            : Task.CompletedTask;

    public Task<IReadOnlyList<HomeyInsightLog>> GetInsightLogsAsync(CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<HomeyInsightLog>>(InsightLogs);

    // A cover of soft blues for the speaker's album art.
    public Task<(byte[] Content, string ContentType)?> GetImageAsync(string imageId, CancellationToken ct)
    {
        const string svg = """
            <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
              <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb3d5"/><stop offset="1" stop-color="#1b3a5c"/></linearGradient></defs>
              <rect width="600" height="600" fill="url(#g)"/>
              <circle cx="300" cy="300" r="160" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="24"/>
            </svg>
            """;
        return Task.FromResult<(byte[], string)?>(imageId == "fake-album-art" ? (System.Text.Encoding.UTF8.GetBytes(svg), "image/svg+xml") : null);
    }

    // A smooth, repeatable curve per log around the reading's starting value, ending now. Meters only go up.
    public Task<IReadOnlyList<HomeyInsightEntry>> GetInsightEntriesAsync(string logId, string resolution, CancellationToken ct)
    {
        var log = InsightLogs.FirstOrDefault(l => l.Id == logId)
            ?? throw new HomeyNotFoundException($"Insight log {logId} not found in Homey");
        var capabilityId = logId.Split(':')[^1];
        var start = Devices.FirstOrDefault(d => log.OwnerUri == $"homey:device:{d.Id}")?.Capabilities[capabilityId].Value.GetDouble() ?? 12;

        const int points = 60;
        var window = InsightResolutions.Window(resolution);
        var end = time.GetUtcNow();
        IReadOnlyList<HomeyInsightEntry> entries = Enumerable.Range(0, points)
            .Select(i =>
            {
                var t = end - window * (points - 1 - i) / (points - 1);
                var phase = (t - DateTimeOffset.UnixEpoch).TotalSeconds / window.TotalSeconds * 2 * Math.PI;
                var wave = Math.Sin(phase * 3) * 0.6 + Math.Sin(phase * 7) * 0.4;
                var value = capabilityId switch
                {
                    // About a day's use per 2000 units on the meter.
                    _ when capabilityId.StartsWith("meter_") => start - (points - 1 - i) / (double)(points - 1) * window.TotalDays * start * 0.0005,
                    "measure_temperature" => start + wave * 1.5,
                    "measure_humidity" => Math.Clamp(start + wave * 8, 0, 100),
                    // Power that is off now was on earlier, so its chart is not flat.
                    "measure_power" => start > 0 ? start * (1 + wave * 0.5) : Math.Max(0, wave) * 1200,
                    _ => Math.Max(0, start * (1 + wave * 0.3)),
                };
                return new HomeyInsightEntry(t, Math.Round(value, 1));
            })
            .ToList();
        return Task.FromResult(entries);
    }

    private static HomeyDevice Device(string id, string name, string zoneId, string @class, params HomeyCapability[] capabilities) =>
        new(id, name, zoneId, Zones.Single(z => z.Id == zoneId).Name, @class, Available: true, UnavailableMessage: null,
            capabilities.ToDictionary(c => c.Id));

    private static HomeyDevice Unavailable(HomeyDevice device, string message) =>
        device with { Available = false, UnavailableMessage = message };

    private static HomeyCapability OnOff(bool on) => Capability("onoff", "Turned on", "boolean", on ? True : False, true);

    private static HomeyCapability Dim(double level) => Number("dim", "Brightness", level, null, true, 0, 1, 0.01);

    private static HomeyCapability Target(double degrees) =>
        Number("target_temperature", "Target temperature", degrees, "°C", true, 5, 30, 0.5);

    private static HomeyCapability Temperature(double degrees) => Number("measure_temperature", "Temperature", degrees, "°C", false);

    private static HomeyCapability Humidity(double percent) => Number("measure_humidity", "Humidity", percent, "%", false);

    private static HomeyCapability Power(double watts) => Number("measure_power", "Power", watts, "W", false);

    private static HomeyCapability Cover(string position) =>
        Capability("windowcoverings_state", "Position", "enum", JsonSerializer.SerializeToElement(position), true) with
        {
            Values = [new("up", "Up"), new("idle", "Stopped"), new("down", "Down")],
        };

    private static HomeyCapability Group(string name) => Capability("sonos_group", "Group", "string", JsonSerializer.SerializeToElement(name), false);

    // A button: something to press, which has no value.
    private static HomeyCapability Button(string id, string title) => Capability(id, title, "boolean", Null, true);

    private static HomeyCapability Alarm(string id, string title, bool on) => Capability(id, title, "boolean", on ? True : False, false);

    private static HomeyCapability Number(string id, string title, double value, string? units, bool setable,
        double? min = null, double? max = null, double? step = null) =>
        new(id, title, "number", JsonSerializer.SerializeToElement(value), units, setable, true, min, max, step, null);

    private static HomeyCapability Capability(string id, string title, string type, JsonElement value, bool setable) =>
        new(id, title, type, value, null, setable, true, null, null, null, null);
}
