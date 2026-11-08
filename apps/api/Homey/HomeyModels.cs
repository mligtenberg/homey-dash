using System.Text.Json;

namespace HomeyDash.Api.Homey;

// The API's view of Homey. Mirrored in libs/api-client/src/lib/homey.ts.

// NotSetUp while no Homey account is set up in Management (ADR-0007).
public enum HomeyConnection { Connecting, Connected, Disconnected, NotSetUp }

// How HomeyDash's connection to the Homey of one account (AccountId) is doing.
public sealed record HomeyStatus(int AccountId, HomeyConnection Connection, string? LastError, DateTimeOffset Since, bool Fake);

public sealed record HomeyCapability(
    string Id,
    string Title,
    string Type,
    JsonElement Value,
    string? Units,
    bool Setable,
    bool Getable,
    double? Min,
    double? Max,
    double? Step,
    DateTimeOffset? LastUpdated)
{
    // The values an enum capability takes, in Homey's order; null for other types.
    public IReadOnlyList<HomeyEnumValue>? Values { get; init; }
}

public sealed record HomeyEnumValue(string Id, string Title);

public sealed record HomeyDevice(
    string Id,
    string Name,
    string? ZoneId,
    string? ZoneName,
    string Class,
    bool Available,
    string? UnavailableMessage,
    IReadOnlyDictionary<string, HomeyCapability> Capabilities)
{
    // What a speaker is playing, as a picture; null when Homey has none for the device.
    public HomeyImage? AlbumArt { get; init; }
}

// A picture Homey keeps, which HomeyDash serves at /api/homey/images/{Id}. Version changes whenever the picture does.
public sealed record HomeyImage(string Id, string? Version);

// A room or area in Homey; zones nest, and only the top one (Home) has no parent.
public sealed record HomeyZone(string Id, string Name, string? ParentId);

public sealed record HomeyFlow(string Id, string Name, bool Advanced, bool Enabled, string? FolderId);

// A folder of flows in Homey; folders nest, and a flow outside any folder has no FolderId.
public sealed record HomeyFlowFolder(string Id, string Name, string? ParentId);

// Colors holds the light colours the mood sets, one per light it turns on in colour or white mode, in Homey's order.
public sealed record HomeyMood(string Id, string Name, string? ZoneId, IReadOnlyList<HomeyLightColor> Colors);

// A light's colour as Homey sets it, each part 0–1: a hue and saturation in colour mode, or a white's temperature
// (0 cool, 1 warm) in temperature mode.
public sealed record HomeyLightColor(double? Hue, double? Saturation, double? Temperature);

// One point of an insight log; V is null for a gap.
public sealed record HomeyInsightEntry(DateTimeOffset T, double? V);

// A Homey Logic variable; Type is boolean, number or string.
public sealed record HomeyVariable(string Id, string Name, string Type, JsonElement Value);

// The weather where Homey is, as Homey's own weather reports it: degrees Celsius, a condition such as Clouds or Rain,
// humidity as a fraction 0–1, and the place it is for. Any part Homey leaves out is null.
public sealed record HomeyWeather(double? Temperature, string? State, double? Humidity, string? City);

// Where Homey is, in degrees, as set in its own settings; the weather tile's forecast is for here.
public sealed record HomeyLocation(double Latitude, double Longitude);

// Homey's own energy report, for the energy tile (ADR-0014). Status is "ok", or "unavailable" when Homey won't tell: the API key
// lacks the homey.energy.readonly scope, or the Homey has no energy. Live and Day are null until read, or when Homey left them out.
public sealed record HomeyEnergy(string Status, EnergyLive? Live, EnergyDay? Day)
{
    public static readonly HomeyEnergy Unavailable = new("unavailable", null, null);
}

// Power now, in watts. Grid is positive while importing and negative while exporting; Solar is what is produced (null without
// solar) and Home what the home consumes.
public sealed record EnergyLive(double? Grid, double? Solar, double? Home);

// Today's totals in kWh, and the day by the hour.
public sealed record EnergyDay(double? Imported, double? Exported, double? Solar, double? Home, IReadOnlyList<EnergyPoint> History);

// One step of today's history, in kWh over the step; T is where it starts.
public sealed record EnergyPoint(DateTimeOffset T, double? Home, double? Solar);

// Something a Sonos speaker can play, as its flow card offers it. Item is the card's own answer, handed back to play it.
public sealed record SpeakerMusic(string Name, string? Description, string? Image, JsonElement Item);

// An app a device can open (an Apple TV's Netflix, an Xbox game), as its flow card offers it. Item is the card's own answer,
// handed back to open it.
public sealed record DeviceApp(string Name, string? Image, JsonElement Item)
{
    // What kind of app it is, such as Entertainment; null when it is not known.
    public string? Category { get; init; }

    // Whether it is for watching or listening (video, music, sports), which the apps list shows first.
    public bool Media { get; init; }
}

public static class SpeakerMusicKinds
{
    public const string Favorite = "favorite";
    public const string Playlist = "playlist";
}

public sealed record HomeyInsightLog(string Id, string OwnerUri, string? OwnerName, string Title, string Type, string? Units);

// Something in Homey changed; raised by HomeyState.
public abstract record HomeyChange;

public sealed record DeviceChanged(HomeyDevice Device) : HomeyChange;

public sealed record DeviceRemoved(string DeviceId) : HomeyChange;

public sealed record VariableChanged(HomeyVariable Variable) : HomeyChange;

public sealed record VariableRemoved(string VariableId) : HomeyChange;

// Flows, flow folders, moods or zones were added, renamed, moved or removed.
public sealed record CatalogChanged : HomeyChange;

public sealed record WeatherChanged(HomeyWeather Weather) : HomeyChange;

public sealed record EnergyChanged(HomeyEnergy Energy) : HomeyChange;

public sealed record ConnectionChanged(HomeyStatus Status) : HomeyChange;

// The device, capability, flow or mood does not exist in Homey.
public sealed class HomeyNotFoundException(string message) : Exception(message);

// HomeyDash cannot reach Homey right now.
public sealed class HomeyUnavailableException(string message, Exception? inner = null) : Exception(message, inner);
