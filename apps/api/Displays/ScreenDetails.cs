namespace HomeyDash.Api.Displays;

/// <summary>
/// What a screen says about itself and the browser it runs in, for Management; reported when it connects and when
/// something changes, such as its size. Everything is optional because browsers differ in what they tell.
/// </summary>
public sealed record ScreenDetails(
    int? ScreenWidth,
    int? ScreenHeight,
    int? ViewportWidth,
    int? ViewportHeight,
    double? PixelRatio,
    string? Orientation,
    string? UserAgent,
    string? Language,
    string? TimeZone,
    int? TouchPoints,
    bool SecureContext,
    string? Connection,
    DateTimeOffset? LoadedAt,
    FullyDetails? Fully,
    LightDetails? Light,
    BatteryDetails? Battery)
{
    /// <summary>The same details with every text cut to a sane length and numbers kept to sane values.</summary>
    public ScreenDetails Cleaned() => this with
    {
        Orientation = Cut(Orientation, 40),
        UserAgent = Cut(UserAgent, 400),
        Language = Cut(Language, 40),
        TimeZone = Cut(TimeZone, 80),
        Connection = Cut(Connection, 40),
        PixelRatio = PixelRatio is { } r && double.IsFinite(r) ? Math.Round(r, 2) : null,
        Fully = Fully is null ? null : Fully with
        {
            Version = Cut(Fully.Version, 40),
            Api = Fully.Api.Take(60).Select(a => Cut(a, 60)!).ToList(),
        },
        Light = Light is null ? null : Light with { Source = Cut(Light.Source, 20) },
        Battery = Battery is { Level: { } l } b && double.IsFinite(l) ? b with { Level = Math.Clamp(l, 0, 1) } : null,
    };

    private static string? Cut(string? text, int length) => text is { Length: > 0 } ? text[..Math.Min(text.Length, length)] : null;
}

/// <summary>Fully Kiosk Browser's JavaScript interface as the screen sees it: its version and which of its functions exist.</summary>
public sealed record FullyDetails(string? Version, List<string> Api);

/// <summary>How the screen measures light: <c>sensor</c> or <c>camera</c> once it has, null while it hasn't or can't.</summary>
public sealed record LightDetails(bool Available, string? Source);

/// <summary>The screen's battery, 0 to 1.</summary>
public sealed record BatteryDetails(double? Level, bool? Charging);
