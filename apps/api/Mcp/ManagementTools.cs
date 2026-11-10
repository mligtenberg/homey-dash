using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Photos;
using HomeyDash.Api.Plex;
using HomeyDash.Api.Realtime;
using HomeyDash.Api.Rules;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol;
using ModelContextProtocol.Server;

namespace HomeyDash.Api.Mcp;

/// <summary>
/// What Management does, offered to AI assistants over MCP: building dashboards and assigning them to displays.
/// Each tool follows the same rules as its endpoint and tells screens and Management just the same.
/// </summary>
[McpServerToolType]
public sealed class ManagementTools(
    HomeyDashDbContext db, Homeys homeys, PlexWatcher plex, TargetCatalog targets, RealtimeNotifier notifier, DisplayPresence presence,
    RuleEngine rules, TimeProvider time)
{
    public const string Path = "/mcp";

    // Arguments and results read and write dashboards as the API does. The SDK needs a resolver set explicitly.
    public static JsonSerializerOptions Json { get; } = new(Dashboard.Json) { TypeInfoResolver = new DefaultJsonTypeInfoResolver() };

    // Mirrors CORE_TILES in libs/tiles/src/lib/core/core-tiles.ts, PLEX_TILES in libs/tiles/src/lib/plex/plex-tiles.ts, WEATHER_TILES in libs/tiles/src/lib/weather/weather-tiles.ts, TRAFFIC_TILES in libs/tiles/src/lib/traffic/traffic-tiles.ts, TIME_TILES in libs/tiles/src/lib/time/time-tiles.ts, SONOS_TILES in libs/tiles/src/lib/sonos/sonos-tiles.ts and
    // LOGIC_TILES in libs/tiles/src/lib/logic/logic-tile.ts; the API only looks inside a logic tile's rules (ADR-0003, ADR-0010).
    private const string TileKinds = """
        Tile kinds, with the sizes each supports and the target type its settings.target takes:
        - "device" (small, wide, large): a device; optional settings.capability picks the capability shown (absent: automatic).
        - "flow" (small, wide): a flow, started when pressed.
        - "mood" (small, wide): a mood, activated when pressed.
        - "mood-list" (wide, full, large, full-large): several moods, a button each; settings.targets lists their ids in order
          and settings.target is null. A page shows 4 moods on wide, 6 on full, 10 on large and 15 on full-large; more go on pages people swipe to, so put the most used first.
        - "statistic" (large, full-large): an insight log, charted; optional settings.window is lastHour, last24Hours (default), last7Days or last31Days.
        - "photo" (small, wide, full, large, full-large): a photo set, its photos shown one at a time in shuffled order; settings.target
          is the photo set's target ("photo-set:<id>"); optional settings.interval is the seconds between photos (default 30).
        - "plex-now-playing" (small, wide, full, large, full-large): what plays on a Plex player, with play/pause and skip buttons;
          settings.target is "plex-player:any" for whatever plays, or a player's target.
        - "plex-recent" (small, wide, full, large, full-large): the posters of what was newly added to Plex; settings.target is
          "plex-library:all" or a library's target.
        - "plex-library" (small, wide, full, large, full-large): a Plex library; its posters on the tile, and a press opens everything
          in it, films, series or albums, alphabetically; settings.target is "plex-library:all" (every library, as tabs) or a
          library's target.
        - "weather" (small, wide, full, large, full-large): the weather where a Homey is, from Open-Meteo, with Buienradar's rain
          for the next two hours in the Netherlands and Belgium; small shows now, wide adds the next hours or rain, large and
          full-large the coming days. A press opens the full forecast. settings.target is "weather:here" for where a Homey is
          (settings.account picks which), or "weather:place" for a place of its own in settings.place,
          { "name", "latitude", "longitude" } in degrees.
        - "traffic" (small, wide, full, large, full-large): the car travel time now on one route from TomTom, with the delay over
          the usual time; wide and up add the distance, arrival time and usual time. It points at nothing in Homey:
          settings.target is null and settings.route is { "name", "origin": { "name", "latitude", "longitude" },
          "destination": { same } } in degrees (places are found by name in Management). settings.account picks the TomTom
          account (the oldest without it). Needs a TomTom account set up in Management.
        - "news" (small, wide, full, large, full-large): the latest headlines from NOS; small and wide show the newest, larger
          sizes more. It points at nothing in Homey: settings.target is null. Optional settings.source is nos (default),
          nos-binnenland, nos-buitenland, nos-economie, nos-sport or nos-tech.
        - "clock" (small, wide, full, large, full-large): the time, with the date from wide up; settings.target is null.
          Optional settings.style is digital (default) or analog, settings.hours 12 or 24 (absent: the display's language),
          settings.seconds true to show seconds, settings.showDate false to hide the date.
        - "date" (small, wide, full, large, full-large): today's date, and from large the month as a calendar with today
          marked; settings.target is null; optional settings.weekNumbers true numbers the weeks of the calendar.
        - "energy" (small, wide, full, large, full-large): Homey's own energy report; small shows the grid power now (import or
          export), wide and full add solar, home consumption and a flow bar, large and full-large add today's totals and a
          small history of the day. A press opens today in full. settings.target is "energy:home" (settings.account picks
          which Homey). It shows as unavailable when the Homey's API key lacks the homey.energy.readonly scope.
        - "sonos" (small, wide, full, large, full-large, full-tall): Sonos multiroom; settings.targets lists the ids of the speaker
          devices in order and settings.target is null. The tile shows what the first room that plays is playing with play/pause
          (and skip, from wide up) and one volume for its group; a press opens every room with its own volume and a button that
          adds it to that group. A full-tall tile lists the rooms on the tile too. Speakers are in a group when their sonos_group
          capability matches. All speakers are in the tile's one account. Optional settings.lock is the id of one of settings.targets: the
          tile then always controls that room; without it the tile shows a room picker and controls the room picked there.
        - "logic" (small, wide, full, large, full-large): shows the first of the tiles it holds whose rule holds, else its
          fallback tile, else nothing (like empty cells). settings.target is null; settings.entries is an ordered list of
          { "tile": { "kind", "settings" }, "rule": <rule> }; settings.fallback is { "kind", "settings" } or null; optional
          settings.minShowSeconds keeps a tile it switched to on screen at least that long (default 0). The tiles it holds
          take its size, so hold only kinds that support that size, and never another logic tile. Keep a dashboard's
          existing logic tiles as they are when changing other parts of the draft.
        Every tile's settings may have a "label" that overrides its target's name. A home can have several Homey and Plex
        accounts: a Homey, weather, energy or Plex tile's settings.account is the account of its target (list_targets gives it); left out, the
        oldest account. A mood-list tile's moods are all in its one account.
        """;

    // Mirrors Operators in apps/api/Rules/Operators.cs.
    private const string RuleSchema = """
        A rule is { "match": "all" or "any", "conditions": [ { "signal", "operator", "value", "not" } ] }: conditions,
        of which all or any must hold. A group in "conditions" is itself { "match", "conditions" }, so "A and B, or C" is
        { "match": "any", "conditions": [ { "match": "all", "conditions": [A, B] }, C ] }. "signal" is a signal's id from
        list_signals; "not" (default false) negates the condition. A condition compares its signal with a fixed value, by
        an operator that suits the signal's type; the value's shape depends on the operator:
        - number: "equals", "greaterThan", "lessThan" (a number); "between" ({ "min": 18, "max": 21 }, both included)
        - yesNo: "isTrue", "isFalse" (no value)
        - text: "equals", "contains", "startsWith" (a string; for a signal with allowedValues, equals takes one of their
          "value"s); "isEmpty" (no value)
        - dateTime: "timeOfDayBetween" ({ "from": "22:00", "to": "06:30" }, may wrap midnight, "HH:mm" or "HH:mm:ss");
          "onWeekdays" (["saturday", "sunday"]); "withinLast", "longerAgoThan" ({ "amount": 30, "unit": "seconds" },
          unit seconds, minutes, hours or days); "dateBetween" ({ "from": "12-01", "to": "01-06" }, month-day, both
          included, every year); "before", "after" (an ISO 8601 moment with offset)
        "clock:now" is the current time; "display:name" equals the id of a display (its allowedValues list them), and
        "display:touched" is when that display was last touched. A condition on a missing signal, or one without a value
        yet, never holds, even negated.
        """;

    [McpServerTool(Name = "list_dashboards", ReadOnly = true)]
    [Description("Lists all dashboards with their publish state, whether the draft has unpublished changes, and how many tiles point at something Homey does not know.")]
    public Task<List<DashboardSummary>> ListDashboards(CancellationToken ct) => DashboardEndpoints.ListAsync(db, targets, ct);

    [McpServerTool(Name = "get_dashboard", ReadOnly = true)]
    [Description("Gets a dashboard with its draft and published layouts.")]
    public async Task<DashboardDetail> GetDashboard(Guid dashboardId, CancellationToken ct) =>
        (await FindDashboardAsync(dashboardId, ct)).ToDetail(targets);

    [McpServerTool(Name = "create_dashboard")]
    [Description("Creates a dashboard with an empty draft of 4 rows. Fill it with save_draft and make it showable with publish_dashboard.")]
    public async Task<DashboardDetail> CreateDashboard([Description("At most 100 characters.")] string name, CancellationToken ct)
    {
        Refuse(DashboardValidator.ValidateName(name));
        var dashboard = new Dashboard { Name = name.Trim() };
        db.Dashboards.Add(dashboard);
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        return dashboard.ToDetail(targets);
    }

    [McpServerTool(Name = "rename_dashboard", Idempotent = true)]
    [Description("Renames a dashboard.")]
    public async Task<DashboardDetail> RenameDashboard(Guid dashboardId, [Description("At most 100 characters.")] string name, CancellationToken ct)
    {
        var dashboard = await FindDashboardAsync(dashboardId, ct);
        Refuse(DashboardValidator.ValidateName(name));
        dashboard.Name = name.Trim();
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        return dashboard.ToDetail(targets);
    }

    [McpServerTool(Name = "save_draft", Idempotent = true)]
    [Description($$"""
        Replaces a dashboard's draft. Displays never show a draft; publish it to show it.
        A dashboard has 1 to 12 rows. Each section is a grid 3 columns wide and as many rows tall as the dashboard;
        sections sit side by side and scroll horizontally. A tile's position is the zero-based column and row of its
        top-left cell. Sizes in cells (columns×rows): small 1×1, wide 2×1, full 3×1, large 2×2, full-large 3×2, full-tall 3×4.
        Tiles must stay inside their section's grid and never overlap. Section and tile ids are any unique strings.
        A section with hidden true stays in the draft but displays leave it out; one with a rule is shown only while it holds.
        "background" sets what shows behind the tiles: { "kind": "color", "color": "#rrggbb" }, { "kind": "gradient",
        "color": "#rrggbb", "to": "#rrggbb", "angle": 0-359 } (as in CSS: 0 upwards, 90 to the right), or { "kind": "image",
        "imageId" } for an image uploaded in Management (keep the one the draft has; assistants can't upload), or
        { "kind": "preset", "preset": "<style>/<subject>" } for a built-in image, drawn by day for the light theme and by
        night for the dark one, optionally recoloured with "color": "#rrggbb" and "angle": 0-359 (the second colour that
        many degrees on around the hue wheel, the third and fourth opposite the first two): styles geometric, pixel-art, line-art,
        watercolor, low-poly, flat, synthwave; subjects living-room, bathroom, media, music, kitchen, bedroom, garden,
        kids-room, office, energy, climate, security, garage, outdoors. Null or left out is the theme's own.
        Find targets with list_targets, and the signals rules use with list_signals.
        {{TileKinds}}
        {{RuleSchema}}
        """)]
    public async Task<DashboardDetail> SaveDraft(Guid dashboardId, DashboardLayout draft, CancellationToken ct)
    {
        var dashboard = await FindDashboardAsync(dashboardId, ct);
        var errors = DashboardEndpoints.Validate(draft, rules);
        if (await BackgroundImageEndpoints.MissingImageAsync(db, draft, ct) is { } missing) errors["background.imageId"] = [missing];
        if (errors.Count > 0)
            throw new McpException("The draft breaks the layout rules: "
                + string.Join("; ", errors.Select(e => $"{e.Key}: {string.Join(" ", e.Value)}")));
        dashboard.SaveDraft(DashboardEndpoints.WithSettings(draft));
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        return dashboard.ToDetail(targets);
    }

    [McpServerTool(Name = "publish_dashboard")]
    [Description("Makes a dashboard's draft its published version. Every display showing it switches to the new version at once.")]
    public async Task<DashboardDetail> PublishDashboard(Guid dashboardId, CancellationToken ct)
    {
        var dashboard = await FindDashboardAsync(dashboardId, ct);
        dashboard.Publish(time.GetUtcNow());
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        await notifier.ScreensChangedAsync(db, await DisplayQueries.ScreensShowingAsync(db, dashboardId, ct), ct);
        return dashboard.ToDetail(targets);
    }

    [McpServerTool(Name = "list_displays", ReadOnly = true)]
    [Description("Lists the displays (the screens in the home that completed setup), each with the dashboards it offers in order, its idle rules, and whether it is connected and shows the latest published version of each.")]
    public Task<List<DisplayInfo>> ListDisplays(CancellationToken ct) => DisplayQueries.ListAsync(db, presence, ct);

    [McpServerTool(Name = "assign_dashboards", Idempotent = true)]
    [Description("""
        Assigns a display the dashboards it offers, in order; people switch between them from a tape along the left of
        the screen. It starts on the first, unless an idle rule holds (see set_idle_rules). Every dashboard must be
        published. Without dashboards the display waits for one. Idle rules on a dashboard that is no longer assigned
        are dropped; the others stay.
        """)]
    public async Task<DisplayInfo> AssignDashboards(Guid displayId, Guid[] dashboardIds, CancellationToken ct = default)
    {
        if (await db.Displays.FindAsync([displayId], ct) is not { } display)
            throw new McpException($"Display {displayId} not found.");
        Refuse(await DisplayEndpoints.AssignAsync(db, display, dashboardIds, ct));
        await db.SaveChangesAsync(ct);
        await notifier.ScreensChangedAsync(db, [display.ScreenId], ct);
        return await DisplayQueries.InfoAsync(db, presence, display, ct);
    }

    [McpServerTool(Name = "set_idle_rules", Idempotent = true)]
    [Description($$"""
        Sets what a display shows once it is left alone for a minute, and while it stays alone: what the first entry in
        this ordered list whose rule holds says; when none holds, it stays on what it shows (on start, its first
        dashboard). An entry either shows a dashboard, { "dashboardId", "rule": <rule> }, which must be one the display
        offers (see list_displays), plays a photo set full screen, { "photoSetId", "rule": <rule>, "returnDashboardId"? },
        or fills the screen with one colour, { "color": "#rrggbb", "rule": <rule>, "returnDashboardId"? } (such as
        "#000000" to darken it at night), or turns the screen off, { "screenOff": true, "rule": <rule>, "returnDashboardId"? }
        (on a display in Fully Kiosk Browser; elsewhere it goes black), until someone touches the screen, which goes back to returnDashboardId (a
        dashboard the display offers) or, without it, to the dashboard shown last. A photo set's id is what follows
        "photo-set:" in its target (see list_targets). Replaces the display's idle rules as a whole.
        {{RuleSchema}}
        """)]
    public async Task<DisplayInfo> SetIdleRules(Guid displayId, IdleRule[] idleRules, CancellationToken ct = default)
    {
        if (await db.Displays.FindAsync([displayId], ct) is not { } display)
            throw new McpException($"Display {displayId} not found.");
        if (await DisplayEndpoints.SetIdleRulesAsync(db, display, idleRules, rules, ct) is { } errors)
            throw new McpException(string.Join(" ", errors.Select(e => $"{e.Key}: {string.Join(" ", e.Value)}")));
        await db.SaveChangesAsync(ct);
        await notifier.ScreensChangedAsync(db, [display.ScreenId], ct);
        return await DisplayQueries.InfoAsync(db, presence, display, ct);
    }

    [McpServerTool(Name = "set_lock_screen", Idempotent = true)]
    [Description($$"""
        Sets what a display's lock screen shows: widgets laid over the photo set or colour an idle rule plays (see
        set_idle_rules), in order, at most 8. Each sits in a spot, one of "top-left", "top-right",
        "center", "bottom-left" or "bottom-right"; widgets in the same spot stack in order. A widget is the time and
        date, { "kind": "clock", "spot" }, the weather where a Homey is, { "kind": "weather", "spot", "account"? } (the
        Homey account's id, or the oldest without it), or the value of a device's capability, { "kind": "value", "spot",
        "signal" }, whose signal is a Homey capability signal (homey:<account>:capability:<device>:<capability>, see
        list_signals), or the car travel time on a route from TomTom, { "kind": "traffic", "spot", "route": { "name",
        "origin": { "name", "latitude", "longitude" }, "destination": { same } }, "account"? } (the TomTom account's id,
        or the oldest without it; needs a TomTom account set up in Management). A widget of any kind with "hidden": true
        stays configured but is left out; one with a "rule" is shown only while it holds. Replaces the display's lock
        screen as a whole.
        {{RuleSchema}}
        """)]
    public async Task<DisplayInfo> SetLockScreen(Guid displayId, LockWidget[] widgets, CancellationToken ct = default)
    {
        if (await db.Displays.FindAsync([displayId], ct) is not { } display)
            throw new McpException($"Display {displayId} not found.");
        if (DisplayEndpoints.SetLockScreen(display, widgets, rules) is { } errors)
            throw new McpException(string.Join(" ", errors.Select(e => $"{e.Key}: {string.Join(" ", e.Value)}")));
        await db.SaveChangesAsync(ct);
        await notifier.ScreensChangedAsync(db, [display.ScreenId], ct);
        return await DisplayQueries.InfoAsync(db, presence, display, ct);
    }

    // Account: the account a tile on it names in settings.account, for kinds that can have several.
    // Zone: the room a device or mood is in, with its parents ("Upstairs > Bedroom"); null when it is in none.
    public sealed record Target(string Id, string Name, string? Detail, int? Account = null, string? Zone = null);

    private static string? ZonePath(HomeyDash.Api.Homey.HomeyState state, string? zoneId)
    {
        List<string> names = [];
        for (var zone = zoneId is null ? null : state.Zones.FirstOrDefault(z => z.Id == zoneId); zone is not null && names.Count < 10;
            zone = zone.ParentId is null ? null : state.Zones.FirstOrDefault(z => z.Id == zone.ParentId))
            names.Insert(0, zone.Name);
        return names.Count == 0 ? null : string.Join(" > ", names);
    }

    [McpServerTool(Name = "list_targets", ReadOnly = true)]
    [Description("""
        Lists what tiles can point at: their ids go in a tile's settings.target. Devices, flows, moods and insight logs are in
        Homey; a device's and a mood's zone is the room it is in; a device's detail lists its capability ids, for a device tile's settings.capability. Photo sets follow an Immich
        album and are made in Management, so assistants can only use the ones that exist.
        """)]
    public async Task<IEnumerable<Target>> ListTargets(
        [Description("device, flow, mood, insight, photoSet, plexPlayer, plexLibrary, weather or energy")] string type, CancellationToken ct) =>
        type switch
        {
            "device" => homeys.All.SelectMany(h => h.State.Devices.OrderBy(d => d.Name).Select(d =>
                new Target(d.Id, d.Name, $"{d.Class} in {d.ZoneName ?? "no zone"} on {h.Name}; capabilities: {string.Join(", ", d.Capabilities.Keys)}", h.AccountId, ZonePath(h.State, d.ZoneId)))),
            "flow" => homeys.All.SelectMany(h => h.State.Flows.OrderBy(f => f.Name).Select(f =>
                new Target(f.Id, f.Name, f.Enabled ? $"on {h.Name}" : $"on {h.Name}, turned off", h.AccountId))),
            "mood" => homeys.All.SelectMany(h => h.State.Moods.OrderBy(m => m.Name).Select(m => new Target(m.Id, m.Name, $"on {h.Name}", h.AccountId, ZonePath(h.State, m.ZoneId)))),
            "insight" => await InsightLogsAsync(ct),
            "photoSet" => (await db.PhotoSets.AsNoTracking().ToListAsync(ct)).OrderBy(p => p.Name).Select(p =>
                new Target(p.Target, p.Name, (p.Photos.Count == 1 ? "1 photo" : $"{p.Photos.Count} photos") + (p.Selection is null ? $" from the Immich album {p.AlbumName}" : " drawn at random from Immich"))),
            "plexPlayer" => plex.Overviews.SelectMany(o => (IEnumerable<Target>)[
                new Target(TargetCatalog.AnyPlexPlayer, "Any player", $"whatever plays on {o.AccountName}", o.AccountId),
                .. o.Players.Select(p => new Target(TargetCatalog.PlexPlayerPrefix + p.Id, p.Name, $"on {o.AccountName}, played since HomeyDash started", o.AccountId))]),
            "plexLibrary" => plex.Overviews.SelectMany(o => (IEnumerable<Target>)[
                new Target(TargetCatalog.AllPlexLibraries, "All libraries", $"on {o.AccountName}", o.AccountId),
                .. o.Libraries.Select(l => new Target(TargetCatalog.PlexLibraryPrefix + l.Id, l.Title, $"{l.Type} on {o.AccountName}", o.AccountId))]),
            "energy" => homeys.All.Select(h => new Target(TargetCatalog.EnergyHome, "Energy", $"of {h.Name}", h.AccountId)),
            "weather" => homeys.All.Select(h => new Target(TargetCatalog.WeatherHere, "Weather", $"where {h.Name} is", h.AccountId))
                .Append(new Target(TargetCatalog.WeatherPlace, "Weather at a place", "the place in settings.place")),
            _ => throw new McpException($"Unknown target type {type}; use device, flow, mood, insight, photoSet, plexPlayer, plexLibrary, weather or energy."),
        };

    public sealed record ZoneInfo(string Id, string Name, string Path, string? ParentId, string Homey, int Account, int Devices, int Moods);

    [McpServerTool(Name = "list_zones", ReadOnly = true)]
    [Description("Lists the zones (rooms) in Homey, with their parent, full path and how many devices and moods are in each. Use list_targets to see which device or mood is in which zone.")]
    public IEnumerable<ZoneInfo> ListZones() =>
        homeys.All.SelectMany(h => h.State.Zones.OrderBy(z => z.Name).Select(z => new ZoneInfo(
            z.Id, z.Name, ZonePath(h.State, z.Id)!, z.ParentId, h.Name, h.AccountId,
            h.State.Devices.Count(d => d.ZoneId == z.Id), h.State.Moods.Count(m => m.ZoneId == z.Id))));

    [McpServerTool(Name = "list_signals", ReadOnly = true)]
    [Description("""
        Lists the signals a logic tile's rules can use: their ids go in a condition's "signal". Each has a type (text,
        yesNo, number or dateTime) that decides its operators, and may have an account (of Homey or Plex), allowedValues
        (for text: the values to compare with), a unit and range (number), or what true and false mean (yesNo).
        """)]
    public IEnumerable<SignalInfo> ListSignals(
        [Description("Only signals from this source: homey, clock, display or plex. Left out, every signal.")] string? source = null) =>
        rules.Signals().Where(s => source is null || s.Source == source);

    // Insight logs are fetched from each Homey, which may be out of reach.
    private async Task<List<Target>> InsightLogsAsync(CancellationToken ct)
    {
        List<Target> logs = [];
        foreach (var h in homeys.All)
        {
            try
            {
                logs.AddRange((await h.Homey.GetInsightLogsAsync(ct)).Select(l => new Target(l.Id,
                    string.Join(" · ", new[] { l.OwnerName, l.Title }.OfType<string>()), $"{l.Units ?? "no units"} on {h.Name}", h.AccountId)));
            }
            catch (Exception e) when (e is HomeyUnavailableException or HttpRequestException)
            {
                throw new McpException($"Homey {h.Name} cannot be reached: {e.Message}");
            }
        }
        return logs;
    }

    private async Task<Dashboard> FindDashboardAsync(Guid id, CancellationToken ct) =>
        await db.Dashboards.FindAsync([id], ct) ?? throw new McpException($"Dashboard {id} not found.");

    private static void Refuse(string? error)
    {
        if (error is not null) throw new McpException(error);
    }
}
