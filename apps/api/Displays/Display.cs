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
    public Guid? DashboardId { get; set; }

    // The id the holding screen keeps in its localStorage. Null once no screen holds this display.
    public Guid? ScreenId { get; set; }

    public DisplaySummary ToSummary() => new(Id, Name, DashboardId);

    public static string? ValidateName(string? name) =>
        string.IsNullOrWhiteSpace(name) ? "A display needs a name."
        : name.Trim().Length > MaxNameLength ? $"A display name has at most {MaxNameLength} characters."
        : null;
}

public sealed record DisplaySummary(Guid Id, string Name, Guid? DashboardId);

/// <summary>The published version a display shows.</summary>
public sealed record ShownDashboard(Guid Id, string Name, int Version, DashboardLayout Layout);

/// <summary>What a screen needs to know: which display it is and what that display shows (null while waiting).</summary>
public sealed record ScreenView(DisplaySummary Display, ShownDashboard? Dashboard);
