using System.Globalization;
using System.Text.Json;
using HomeyDash.Api.Weather;

namespace HomeyDash.Api.Traffic;

// The Traffic section of the configuration.
public sealed class TrafficOptions
{
    // Runs against FakeTraffic instead of TomTom, with one account that can't be changed, for development and tests. Never a fallback.
    public bool Fake { get; set; }
}

/// <summary>
/// A TomTom account (ADR-0015): the API key of a TomTom developer account, under a name that tells a home's accounts apart.
/// Set up in Management and kept in the database (ADR-0007). The key never leaves the backend.
/// </summary>
public sealed record TomTomAccount(string ApiKey)
{
    public int Id { get; init; }

    public string Name { get; init; } = "TomTom";
}

/// <summary>
/// The TomTom accounts set up, oldest first. A route names one in <c>settings.account</c>; one that names none uses the
/// oldest.
/// </summary>
public sealed class TomTomAccounts
{
    private volatile IReadOnlyList<TomTomAccount> _all = [];

    public event Action? Changed;

    public IReadOnlyList<TomTomAccount> All => _all;

    public TomTomAccount? Find(int? id) => id is null ? null : _all.FirstOrDefault(a => a.Id == id);

    // The account with that id, or the oldest when none is named.
    public TomTomAccount? For(int? id) => id is null ? _all.FirstOrDefault() : Find(id);

    public void Set(IEnumerable<TomTomAccount> accounts)
    {
        _all = accounts.OrderBy(a => a.Id).ToList();
        Changed?.Invoke();
    }
}

// A place of a route: its name and where it is, in degrees. Kept as the tile's settings have it.
public sealed record TrafficPlace(string Name, double Latitude, double Longitude)
{
    public bool IsValid => !string.IsNullOrWhiteSpace(Name) && Latitude is >= -90 and <= 90 && Longitude is >= -180 and <= 180;

    internal string Key => Latitude.ToString("F3", CultureInfo.InvariantCulture) + "," + Longitude.ToString("F3", CultureInfo.InvariantCulture);
}

/// <summary>
/// A route a traffic tile or lock screen widget shows: a name and an origin and destination found by name in Management.
/// Routes with the same coordinates, to three decimals (about 100 m), share one result, under <see cref="Key"/>.
/// </summary>
public sealed record TrafficRoute(string Name, TrafficPlace Origin, TrafficPlace Destination)
{
    public string Key => Origin.Key + ">" + Destination.Key;

    // Null-safe, because a route read from JSON may lack a place.
    public bool IsValid => Origin is { IsValid: true } && Destination is { IsValid: true } && Origin.Key != Destination.Key;

    // The route of a traffic tile's settings (<c>settings.route</c>); null when it has none or an unusable one.
    public static TrafficRoute? Of(JsonElement settings)
    {
        if (settings.ValueKind != JsonValueKind.Object || !settings.TryGetProperty("route", out var route)) return null;
        try
        {
            return route.Deserialize<TrafficRoute>(Dashboards.Dashboard.Json) is { IsValid: true } found ? found : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>
/// How a route's traffic is now, from TomTom: the travel time by car now, the usual travel time at this hour (history), the
/// delay now over the usual, the distance, and when leaving now arrives. Status is <c>loading</c> until HomeyDash knows,
/// <c>noAccount</c> without a TomTom account, <c>connected</c>, or <c>disconnected</c> when TomTom can't be reached (Error
/// says why; the last result stays). Pushed to every connection as <c>Traffic</c>.
/// </summary>
public sealed record RouteTraffic(
    string RouteKey, string Status, string? Error, int? TravelSeconds, int? UsualSeconds, int? DelaySeconds, int? DistanceMeters,
    DateTimeOffset? Arrival, DateTimeOffset? UpdatedAt);

// What TomTom says of a route now.
public sealed record RouteTime(int TravelSeconds, int UsualSeconds, int DistanceMeters, DateTimeOffset Arrival);

// TomTom couldn't answer; Message says so for people.
public sealed class TrafficException(string message, bool keyRefused = false, Exception? inner = null) : Exception(message, inner)
{
    // TomTom doesn't accept the account's key.
    public bool KeyRefused { get; } = keyRefused;
}

/// <summary>Where traffic comes from: TomTom, or the fake.</summary>
public interface ITraffic
{
    // Checks that TomTom accepts the key.
    Task CheckAsync(string apiKey, CancellationToken ct);

    Task<RouteTime> RouteAsync(string apiKey, TrafficRoute route, CancellationToken ct);

    // Places whose name starts with the query, best first, named in the language (such as nl) where TomTom can.
    Task<IReadOnlyList<PlaceMatch>> SearchAsync(string apiKey, string query, string language, CancellationToken ct);
}
