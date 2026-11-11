using System.Text.Json;
using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Traffic;

namespace HomeyDash.Api.Displays;

/// <summary>
/// A screen in the home that has completed setup. Its id is its permanent identity; the screen that holds it is
/// recorded separately, so a takeover moves the identity to another screen without changing it.
/// </summary>
public sealed class Display
{
    public const int MaxNameLength = 100;

    public Guid Id { get; init; } = Guid.NewGuid();
    public required string Name { get; set; }

    // The dashboards it offers, by position; it waits while it has none.
    public List<DisplayDashboard> Dashboards { get; init; } = [];

    // Left alone, it does what the first rule that holds says, else stays where it is. Replaced as a whole.
    public List<IdleRule> IdleRules { get; set; } = [];

    // Shown over a photo set or colour an idle rule plays, in place. Replaced as a whole.
    public List<LockWidget> LockWidgets { get; set; } = [];

    // A capability of a device in Homey (a signal id such as homey:1:capability:<device>:measure_luminance) whose lux the
    // screen reports as its brightness instead of measuring with its own sensor or camera; null to measure itself.
    public string? LightSignal { get; set; }

    // The id the holding screen keeps in its localStorage. Null once no screen holds this display.
    public Guid? ScreenId { get; set; }

    // Display status, as reported by the screen: when it was last connected. Each dashboard keeps the version shown.
    public DateTimeOffset? LastSeenAt { get; set; }

    // The order its screen offers them in; it starts on the first.
    public List<Guid> DashboardIds => Dashboards.OrderBy(o => o.Position).Select(o => o.DashboardId).ToList();

    // Rules that show a dashboard it no longer offers, such as a deleted one, are left out; a photo set or colour that
    // went back to one goes back to the last one shown instead.
    public List<IdleRule> OfferedIdleRules() => IdleRules
        .Where(r => r.PhotoSetId is not null || r.Color is not null || r.ScreenOff || r.DashboardId is { } shown && DashboardIds.Contains(shown))
        .Select(r => r.ReturnDashboardId is { } back && !DashboardIds.Contains(back) ? r with { ReturnDashboardId = null } : r)
        .ToList();

    public DisplaySummary ToSummary() => new(Id, Name, DashboardIds, OfferedIdleRules(), LockWidgets, LightSignal);

    // The published version of each dashboard the screen reports it shows; one it leaves out it doesn't show yet.
    public void Showing(IReadOnlyDictionary<Guid, int> versions)
    {
        foreach (var dashboard in Dashboards)
            dashboard.ShownVersion = versions.TryGetValue(dashboard.DashboardId, out var shown) ? shown : null;
    }

    /// <summary>
    /// Makes <paramref name="dashboardIds"/> the dashboards it offers, in this order. A dashboard that stays keeps the
    /// version its screen reported; an idle rule on one that goes goes with it.
    /// </summary>
    public void Assign(IReadOnlyList<Guid> dashboardIds)
    {
        // Rows that stay are changed in place: EF can't track a removed row and a new one with the same key.
        Dashboards.RemoveAll(o => !dashboardIds.Contains(o.DashboardId));
        foreach (var (dashboardId, position) in dashboardIds.Select((d, i) => (d, i)))
        {
            if (Dashboards.Find(o => o.DashboardId == dashboardId) is not { } dashboard)
                Dashboards.Add(dashboard = new DisplayDashboard { DashboardId = dashboardId });
            dashboard.Position = position;
        }
        IdleRules = OfferedIdleRules();
    }

    public static string? ValidateName(string? name) =>
        string.IsNullOrWhiteSpace(name) ? "A display needs a name."
        : name.Trim().Length > MaxNameLength ? $"A display name has at most {MaxNameLength} characters."
        : null;
}

/// <summary>A dashboard a display offers.</summary>
public sealed class DisplayDashboard
{
    public Guid DisplayId { get; init; }
    public Guid DashboardId { get; init; }

    // Where it sits among the display's dashboards.
    public int Position { get; set; }

    // The published version its screen reports it shows.
    public int? ShownVersion { get; set; }
}

/// <summary>
/// A rule (ADR-0010) and what a display left alone does while it holds: show one of its dashboards
/// (<see cref="DashboardId"/>), or play a photo set full screen (<see cref="PhotoSetId"/>) or fill the screen with a
/// colour (<see cref="Color"/>, such as <c>#000000</c>) until it is touched, which goes back to
/// <see cref="ReturnDashboardId"/>, or to the dashboard it showed last when that is null. The rule is kept as sent, once
/// it passed validation.
/// </summary>
public sealed record IdleRule(
    Guid? DashboardId, JsonElement Rule, Guid? PhotoSetId = null, Guid? ReturnDashboardId = null, string? Color = null, bool ScreenOff = false);

/// <summary>
/// Something a display shows on its lock screen, over the photo set or colour an idle rule plays, in one of
/// <see cref="Spots"/>: the time and date (<c>clock</c>), the weather where a Homey is (<c>weather</c>, of the Homey of
/// <see cref="Account"/>, or the oldest), or the value of a device's capability (<c>value</c>, the Homey signal named
/// by <see cref="Signal"/>), or the traffic on a route (<c>traffic</c>, <see cref="Route"/>, with the TomTom account of
/// <see cref="Account"/>, or the oldest), or the latest headline of a news source (<c>news</c>, <see cref="Source"/>, the first without it). Widgets in the same spot stack in order. A <see cref="Hidden"/> widget stays
/// configured but the screen leaves it out; one with a <see cref="Rule"/> (ADR-0010) is shown while it holds, as for a
/// dashboard's sections. The rule stays JSON, kept as sent once it passed validation.
/// </summary>
public sealed record LockWidget(string Kind, string Spot, string? Signal = null, int? Account = null, TrafficRoute? Route = null, bool Hidden = false, JsonElement? Rule = null, string? Source = null)
{
    public const int Max = 8;

    public static readonly IReadOnlyList<string> Kinds = ["clock", "weather", "value", "traffic", "news"];

    public static readonly IReadOnlyList<string> Spots = ["top-left", "top-right", "center", "bottom-left", "bottom-right"];
}

/// <summary>
/// A display, the dashboards it offers in that order, the rules that choose what it shows when left alone, and what
/// its lock screen shows.
/// </summary>
public sealed record DisplaySummary(Guid Id, string Name, List<Guid> DashboardIds, List<IdleRule> IdleRules, List<LockWidget> LockWidgets, string? LightSignal = null);

/// <summary>
/// Which published version of one of its dashboards a display shows. It is on the latest version when
/// <see cref="ShownVersion"/> equals <see cref="LatestVersion"/>.
/// </summary>
public sealed record DashboardVersion(Guid DashboardId, int? ShownVersion, int LatestVersion);

/// <summary>
/// What Management knows about a display beyond its configuration. <see cref="Versions"/> has one entry per
/// dashboard it offers, in order.
/// </summary>
public sealed record DisplayStatus(bool Connected, bool Held, DateTimeOffset? LastSeenAt, List<DashboardVersion> Versions, bool Kiosk = false, double? Lux = null, ScreenDetails? Details = null);

/// <summary>A display as Management lists it.</summary>
public sealed record DisplayInfo(
    Guid Id, string Name, List<Guid> DashboardIds, List<IdleRule> IdleRules, List<LockWidget> LockWidgets, DisplayStatus Status, string? LightSignal = null);

/// <summary>The published version a display shows.</summary>
public sealed record ShownDashboard(Guid Id, string Name, int Version, DashboardLayout Layout);

/// <summary>
/// What a screen needs to know: which display it is and the dashboards it offers, in order (none while waiting).
/// </summary>
public sealed record ScreenView(DisplaySummary Display, List<ShownDashboard> Dashboards);
