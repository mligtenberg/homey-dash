using System.Text.Json;

namespace HomeyDash.Api.Homey;

// The API's view of Homey. Mirrored in libs/api-client/src/lib/homey.ts.

public enum HomeyConnection { Connecting, Connected, Disconnected }

public sealed record HomeyStatus(HomeyConnection Connection, string? LastError, DateTimeOffset Since, bool Fake);

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
    DateTimeOffset? LastUpdated);

public sealed record HomeyDevice(
    string Id,
    string Name,
    string? ZoneId,
    string? ZoneName,
    string Class,
    bool Available,
    string? UnavailableMessage,
    IReadOnlyDictionary<string, HomeyCapability> Capabilities);

public sealed record HomeyFlow(string Id, string Name, bool Advanced, bool Enabled);

public sealed record HomeyMood(string Id, string Name, string? ZoneId);

public sealed record HomeyInsightLog(string Id, string OwnerUri, string? OwnerName, string Title, string Type, string? Units);

// Something in Homey changed; raised by HomeyState.
public abstract record HomeyChange;

public sealed record DeviceChanged(HomeyDevice Device) : HomeyChange;

public sealed record DeviceRemoved(string DeviceId) : HomeyChange;

// Flows or moods were added, renamed or removed.
public sealed record CatalogChanged : HomeyChange;

public sealed record ConnectionChanged(HomeyStatus Status) : HomeyChange;

// The device, capability, flow or mood does not exist in Homey.
public sealed class HomeyNotFoundException(string message) : Exception(message);

// HomeyDash cannot reach Homey right now.
public sealed class HomeyUnavailableException(string message, Exception? inner = null) : Exception(message, inner);
