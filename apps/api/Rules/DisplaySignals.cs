using HomeyDash.Api.Displays;

namespace HomeyDash.Api.Rules;

/// <summary>
/// The display a rule is evaluated for: <c>display:name</c>, whose value is the display's permanent id (so a condition on
/// it survives renaming and follows a takeover) and whose allowed values name every display, and <c>display:touched</c>,
/// when its screen was last touched, and <c>display:brightness</c>, how much light falls on it in lux, as its screen last
/// measured with its light sensor or estimated with its camera. Without a display all are missing; brightness has no value until the screen measures.
/// </summary>
public sealed class DisplaySignals : ISignalSource, IDisposable
{
    public const string Name = "display:name";
    public const string Touched = "display:touched";
    public const string Brightness = "display:brightness";

    private readonly DisplayDirectory _directory;
    private readonly DisplayTouches _touches;
    private readonly DisplayBrightness _brightness;

    public DisplaySignals(DisplayDirectory directory, DisplayTouches touches, DisplayBrightness brightness)
    {
        _directory = directory;
        _touches = touches;
        _brightness = brightness;
        _directory.Changed += OnChanged;
        _touches.Changed += OnChanged;
        _brightness.Changed += OnChanged;
    }

    public event Action? Changed;

    public bool Owns(string signalId) => signalId.StartsWith("display:", StringComparison.Ordinal);

    public IEnumerable<SignalInfo> Signals() => [NameInfo(), TouchedInfo, BrightnessInfo];

    public SignalInfo? Find(string signalId) => signalId switch
    {
        Name => NameInfo(),
        Touched => TouchedInfo,
        Brightness => BrightnessInfo,
        _ => null,
    };

    public bool? Knows(string signalId) => signalId is Name or Touched or Brightness;

    // A display not touched since HomeyDash started counts as touched long ago, so "longer ago than" holds for it.
    public SignalReading Read(string signalId, RuleContext context)
    {
        var display = context.DisplayId is { } id ? _directory.Find(id) : _directory.ByScreen(context.ScreenId);
        if (display is null) return SignalReading.Missing;
        return signalId switch
        {
            Name => SignalReading.Of(display.Id.ToString()),
            Touched => SignalReading.Of(_touches.LastTouched(display.Id) ?? DateTimeOffset.MinValue),
            Brightness => SignalReading.Of(_brightness.Lux(display.Id)),
            _ => SignalReading.Missing,
        };
    }

    private SignalInfo NameInfo() => new(Name, "display", SignalType.Text, "Name", "Current display")
    {
        AllowedValues = _directory.All.Select(d => new AllowedValue(d.Id.ToString(), d.Name)).ToList(),
    };

    private static readonly SignalInfo TouchedInfo = new(Touched, "display", SignalType.DateTime, "Last touched", "Current display");

    private static readonly SignalInfo BrightnessInfo = new(Brightness, "display", SignalType.Number, "Brightness", "Current display")
    {
        Unit = "lx",
        Min = 0,
        Step = 1,
    };

    private void OnChanged() => Changed?.Invoke();

    public void Dispose()
    {
        _directory.Changed -= OnChanged;
        _touches.Changed -= OnChanged;
        _brightness.Changed -= OnChanged;
    }
}
