using System.Text.Json;
using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Homey;

namespace HomeyDash.Api.Weather;

// The Weather section of the configuration.
public sealed class WeatherOptions
{
    // Runs against FakeWeather instead of Open-Meteo and Buienradar, for development and tests. Never a fallback.
    public bool Fake { get; set; }
}

/// <summary>
/// The weather now: degrees Celsius, what it feels like, a WMO weather code, whether it is day, humidity as a fraction
/// 0–1, wind in km/h from a direction in degrees, and precipitation in mm over the last 15 minutes.
/// </summary>
public sealed record WeatherNow(
    double Temperature, double FeelsLike, int Code, bool Day, double Humidity, double Wind, double WindDirection, double Precipitation);

// One hour ahead: from Time, degrees Celsius, a WMO weather code, the chance of precipitation in % and how much in mm.
public sealed record WeatherHour(DateTimeOffset Time, double Temperature, int Code, bool Day, int PrecipitationChance, double Precipitation);

// One day ahead, in the location's own time zone.
public sealed record WeatherDay(
    DateOnly Date, int Code, double Low, double High, int PrecipitationChance, double Precipitation, DateTimeOffset Sunrise,
    DateTimeOffset Sunset);

// How hard it rains, or will, from Time for five minutes, in mm per hour.
public sealed record RainPoint(DateTimeOffset Time, double Rate);

// What Open-Meteo forecasts for one place: now, the next 24 hours and the next 7 days.
public sealed record WeatherForecast(WeatherNow Now, IReadOnlyList<WeatherHour> Hours, IReadOnlyList<WeatherDay> Days);

/// <summary>
/// The weather where the Homey of one account is, or at a place a weather tile chose (ADR-0013): AccountId and AccountName
/// for a Homey's, PlaceKey (<see cref="WeatherPlace.Key"/>) for a place's. Status is <c>loading</c> until HomeyDash
/// knows, <c>noLocation</c> when Homey won't tell where it is, <c>connected</c>, or <c>disconnected</c> when Open-Meteo
/// can't be reached (Error says why; the last forecast stays). Place is the town Homey's own weather names, or the chosen
/// place's name. Rain is the next two hours in steps of five minutes, from Buienradar; null where it doesn't know (outside
/// the Netherlands and Belgium) or couldn't be reached. Pushed to every connection as <c>Forecasts</c>.
/// </summary>
public sealed record Forecast(
    int? AccountId, string? AccountName, string? PlaceKey, string Status, string? Error, string? Place, WeatherNow? Now,
    IReadOnlyList<WeatherHour> Hours, IReadOnlyList<WeatherDay> Days, IReadOnlyList<RainPoint>? Rain, DateTimeOffset? UpdatedAt)
{
    // Where the forecast is for, in degrees; null until Homey says where it is.
    public HomeyLocation? Location { get; init; }
}

/// <summary>
/// A place a weather tile shows the weather of instead of where its Homey is: <c>settings.place</c> of a tile whose target is
/// <c>weather:place</c>. Tiles at the same place to two decimals (about a kilometre) share one forecast, under Key.
/// </summary>
public sealed record WeatherPlace(string Name, double Latitude, double Longitude)
{
    public string Key => Format(Latitude) + "," + Format(Longitude);

    public HomeyLocation Location => new(Latitude, Longitude);

    private static string Format(double degrees) => degrees.ToString("F2", System.Globalization.CultureInfo.InvariantCulture);

    // The place of a weather tile's settings; null when it follows its Homey, or names no usable place.
    public static WeatherPlace? Of(JsonElement settings)
    {
        if (settings.ValueKind != JsonValueKind.Object
            || !settings.TryGetProperty("target", out var target) || target.ValueKind != JsonValueKind.String || target.GetString() != TargetCatalog.WeatherPlace
            || !settings.TryGetProperty("place", out var place) || place.ValueKind != JsonValueKind.Object
            || !place.TryGetProperty("latitude", out var lat) || lat.ValueKind != JsonValueKind.Number
            || !place.TryGetProperty("longitude", out var lon) || lon.ValueKind != JsonValueKind.Number)
            return null;
        var (latitude, longitude) = (lat.GetDouble(), lon.GetDouble());
        if (latitude is < -90 or > 90 || longitude is < -180 or > 180) return null;
        var name = place.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
        return new WeatherPlace(string.IsNullOrWhiteSpace(name) ? "Weather" : name.Trim(), latitude, longitude);
    }
}

// A town found by name, to choose as a weather tile's place: its region and country tell namesakes apart.
public sealed record PlaceMatch(string Name, string? Region, string? Country, double Latitude, double Longitude);

// A weather service that couldn't answer; Message says so for people.
public sealed class WeatherException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Where the weather comes from: Open-Meteo's forecast and Buienradar's rain, or the fake's.</summary>
public interface IWeatherSource
{
    Task<WeatherForecast> ForecastAsync(HomeyLocation location, CancellationToken ct);

    // Null where Buienradar doesn't know.
    Task<IReadOnlyList<RainPoint>?> RainAsync(HomeyLocation location, CancellationToken ct);

    // Towns whose name starts with the query, best first, named in the language (such as nl) where Open-Meteo can.
    Task<IReadOnlyList<PlaceMatch>> SearchAsync(string query, string language, CancellationToken ct);
}
