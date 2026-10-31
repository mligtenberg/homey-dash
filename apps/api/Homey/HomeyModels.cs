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
    IReadOnlyDictionary<string, HomeyCapability> Capabilities);

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

public sealed record HomeyInsightLog(string Id, string OwnerUri, string? OwnerName, string Title, string Type, string? Units);

// Something in Homey changed; raised by HomeyState.
public abstract record HomeyChange;

public sealed record DeviceChanged(HomeyDevice Device) : HomeyChange;

public sealed record DeviceRemoved(string DeviceId) : HomeyChange;

public sealed record VariableChanged(HomeyVariable Variable) : HomeyChange;

public sealed record VariableRemoved(string VariableId) : HomeyChange;

// Flows, flow folders, moods or zones were added, renamed, moved or removed.
public sealed record CatalogChanged : HomeyChange;

public sealed record ConnectionChanged(HomeyStatus Status) : HomeyChange;

// The device, capability, flow or mood does not exist in Homey.
public sealed class HomeyNotFoundException(string message) : Exception(message);

// HomeyDash cannot reach Homey right now.
public sealed class HomeyUnavailableException(string message, Exception? inner = null) : Exception(message, inner);
