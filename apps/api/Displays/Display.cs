using HomeyDash.Api.Dashboards;

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

    // The main dashboard, which the display returns to when left alone. Null while it waits for one.
    public Guid? DashboardId { get; set; }

    // The dashboards it can switch to besides the main one; only a display with a main dashboard has them.
    public List<DisplayDashboard> Others { get; init; } = [];

    // The id the holding screen keeps in its localStorage. Null once no screen holds this display.
    public Guid? ScreenId { get; set; }

    // Display status, as reported by the screen: when it was last connected, and which published version of its
    // main dashboard it shows.
    public DateTimeOffset? LastSeenAt { get; set; }
    public int? ShownVersion { get; set; }

    // Main first, then the others: the order its screen offers them in.
    public List<Guid> DashboardIds =>
        DashboardId is { } main ? [main, .. Others.OrderBy(o => o.Position).Select(o => o.DashboardId)] : [];

    public DisplaySummary ToSummary() => new(Id, Name, DashboardId, DashboardIds.Skip(1).ToList());

    // The published version of each dashboard the screen reports it shows; one it leaves out it doesn't show yet.
    public void Showing(IReadOnlyDictionary<Guid, int> versions)
    {
        ShownVersion = DashboardId is { } main && versions.TryGetValue(main, out var version) ? version : null;
        foreach (var other in Others)
            other.ShownVersion = versions.TryGetValue(other.DashboardId, out var shown) ? shown : null;
    }

    /// <summary>
    /// Makes <paramref name="main"/> the main dashboard and <paramref name="others"/> the ones besides it, in this
    /// order. A dashboard that stays assigned keeps the version its screen reported.
    /// </summary>
    public void Assign(Guid? main, IReadOnlyList<Guid> others)
    {
        var shown = Others.ToDictionary(o => o.DashboardId, o => o.ShownVersion);
        if (DashboardId is { } previous) shown[previous] = ShownVersion;

        DashboardId = main;
        ShownVersion = main is { } id ? shown.GetValueOrDefault(id) : null;
        // Rows that stay are changed in place: EF can't track a removed row and a new one with the same key.
        Others.RemoveAll(o => !others.Contains(o.DashboardId));
        foreach (var (dashboardId, position) in others.Select((d, i) => (d, i)))
        {
            if (Others.Find(o => o.DashboardId == dashboardId) is not { } other)
                Others.Add(other = new DisplayDashboard { DashboardId = dashboardId, ShownVersion = shown.GetValueOrDefault(dashboardId) });
            other.Position = position;
        }
    }

    public static string? ValidateName(string? name) =>
        string.IsNullOrWhiteSpace(name) ? "A display needs a name."
        : name.Trim().Length > MaxNameLength ? $"A display name has at most {MaxNameLength} characters."
        : null;
}

/// <summary>A dashboard a display can switch to besides its main one.</summary>
public sealed class DisplayDashboard
{
    public Guid DisplayId { get; init; }
    public Guid DashboardId { get; init; }

    // Where it sits among the display's other dashboards.
    public int Position { get; set; }

    // The published version its screen reports it shows.
    public int? ShownVersion { get; set; }
}

/// <summary>A display, its main dashboard and the others it can switch to, in the order it offers them.</summary>
public sealed record DisplaySummary(Guid Id, string Name, Guid? DashboardId, List<Guid> OtherDashboardIds);

/// <summary>
/// Which published version of one of its dashboards a display shows. It is on the latest version when
/// <see cref="ShownVersion"/> equals <see cref="LatestVersion"/>.
/// </summary>
public sealed record DashboardVersion(Guid DashboardId, int? ShownVersion, int LatestVersion);

/// <summary>
/// What Management knows about a display beyond its configuration. <see cref="Versions"/> has one entry per
/// assigned dashboard, main first.
/// </summary>
public sealed record DisplayStatus(bool Connected, bool Held, DateTimeOffset? LastSeenAt, List<DashboardVersion> Versions);

/// <summary>A display as Management lists it.</summary>
public sealed record DisplayInfo(Guid Id, string Name, Guid? DashboardId, List<Guid> OtherDashboardIds, DisplayStatus Status);

/// <summary>The published version a display shows.</summary>
public sealed record ShownDashboard(Guid Id, string Name, int Version, DashboardLayout Layout);

/// <summary>
/// What a screen needs to know: which display it is and the dashboards it offers, main first (none while waiting).
/// </summary>
public sealed record ScreenView(DisplaySummary Display, List<ShownDashboard> Dashboards);
