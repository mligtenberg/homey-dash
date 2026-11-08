using System.Globalization;
using System.Text.Json;
using HomeyDash.Api.Homey;

namespace HomeyDash.Api.Weather;

/// <summary>
/// The forecast from Open-Meteo (open-meteo.com, free for non-commercial use, no key) and the rain of the next two hours
/// from Buienradar (buienradar.nl, the Netherlands and Belgium only). See ADR-0013.
/// </summary>
public sealed class WeatherSource(IHttpClientFactory httpFactory, TimeProvider time) : IWeatherSource
{
    public const string HttpClientName = "Weather";

    private const string ForecastUrl = "https://api.open-meteo.com/v1/forecast";
    private const string RainUrl = "https://gpsgadget.buienradar.nl/data/raintext";
    private const string SearchUrl = "https://geocoding-api.open-meteo.com/v1/search";

    // Buienradar's times are the Netherlands' clock.
    private static readonly TimeZoneInfo Amsterdam = TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam");

    public static void ConfigureHttpClient(HttpClient http)
    {
        http.Timeout = TimeSpan.FromSeconds(15);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("HomeyDash");
    }

    public async Task<WeatherForecast> ForecastAsync(HomeyLocation location, CancellationToken ct)
    {
        var url = FormattableString.Invariant(
            $"{ForecastUrl}?latitude={location.Latitude:0.###}&longitude={location.Longitude:0.###}&timezone=auto&timeformat=unixtime")
            + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m,wind_direction_10m,precipitation"
            + "&hourly=temperature_2m,weather_code,is_day,precipitation_probability,precipitation&forecast_hours=24"
            + "&daily=weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max,precipitation_sum,sunrise,sunset&forecast_days=7";
        return ParseForecast(await GetAsync(url, "Open-Meteo", ct));
    }

    public async Task<IReadOnlyList<RainPoint>?> RainAsync(HomeyLocation location, CancellationToken ct)
    {
        var url = FormattableString.Invariant($"{RainUrl}?lat={location.Latitude:0.##}&lon={location.Longitude:0.##}");
        return ParseRain(await GetAsync(url, "Buienradar", ct), time.GetUtcNow());
    }

    public async Task<IReadOnlyList<PlaceMatch>> SearchAsync(string query, string language, CancellationToken ct)
    {
        var url = $"{SearchUrl}?name={Uri.EscapeDataString(query)}&count=8&format=json&language={Uri.EscapeDataString(language)}";
        return ParsePlaces(await GetAsync(url, "Open-Meteo", ct));
    }

    // Open-Meteo's geocoding answer: no results at all when nothing matches.
    public static IReadOnlyList<PlaceMatch> ParsePlaces(string body)
    {
        try
        {
            using var json = JsonDocument.Parse(body);
            if (!json.RootElement.TryGetProperty("results", out var results)) return [];
            return results.EnumerateArray().Select(r => new PlaceMatch(
                r.GetProperty("name").GetString()!, Text(r, "admin1"), Text(r, "country"),
                r.GetProperty("latitude").GetDouble(), r.GetProperty("longitude").GetDouble())).ToList();
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            throw new WeatherException("Open-Meteo answered something unexpected.", e);
        }
    }

    private static string? Text(JsonElement item, string name) =>
        item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private async Task<string> GetAsync(string url, string service, CancellationToken ct)
    {
        try
        {
            using var response = await httpFactory.CreateClient(HttpClientName).GetAsync(url, ct);
            if (!response.IsSuccessStatusCode) throw new WeatherException($"{service} answered {(int)response.StatusCode}.");
            return await response.Content.ReadAsStringAsync(ct);
        }
        catch (Exception e) when (e is HttpRequestException || e is TaskCanceledException && !ct.IsCancellationRequested)
        {
            throw new WeatherException($"Could not reach {service}.", e);
        }
    }

    // Open-Meteo's answer with unixtime: columns of values per hour and per day.
    public static WeatherForecast ParseForecast(string body)
    {
        try
        {
            using var json = JsonDocument.Parse(body);
            var root = json.RootElement;
            var offset = TimeSpan.FromSeconds(root.GetProperty("utc_offset_seconds").GetInt32());
            DateTimeOffset At(JsonElement unix) => DateTimeOffset.FromUnixTimeSeconds(unix.GetInt64()).ToOffset(offset);

            var current = root.GetProperty("current");
            var now = new WeatherNow(
                Number(current, "temperature_2m"), Number(current, "apparent_temperature"), (int)Number(current, "weather_code"),
                Number(current, "is_day") == 1, Number(current, "relative_humidity_2m") / 100, Number(current, "wind_speed_10m"),
                Number(current, "wind_direction_10m"), Number(current, "precipitation"));

            var hourly = root.GetProperty("hourly");
            var hours = Column(hourly, "time").Select((t, i) => new WeatherHour(
                At(t), Number(hourly, "temperature_2m", i), (int)Number(hourly, "weather_code", i), Number(hourly, "is_day", i) == 1,
                (int)Number(hourly, "precipitation_probability", i), Number(hourly, "precipitation", i))).ToList();

            var daily = root.GetProperty("daily");
            var days = Column(daily, "time").Select((t, i) => new WeatherDay(
                DateOnly.FromDateTime(At(t).DateTime), (int)Number(daily, "weather_code", i), Number(daily, "temperature_2m_min", i),
                Number(daily, "temperature_2m_max", i), (int)Number(daily, "precipitation_probability_max", i),
                Number(daily, "precipitation_sum", i), At(Column(daily, "sunrise")[i]), At(Column(daily, "sunset")[i]))).ToList();

            return new WeatherForecast(now, hours, days);
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or IndexOutOfRangeException or FormatException)
        {
            throw new WeatherException("Open-Meteo answered something unexpected.", e);
        }
    }

    // Buienradar's lines of "intensity|HH:mm": 0–255 for 10^((intensity − 109) / 32) mm per hour, by the Dutch clock. A time
    // more than 12 hours from now is around midnight, on the day before or after. Null when there are no lines (outside its map).
    public static IReadOnlyList<RainPoint>? ParseRain(string body, DateTimeOffset now)
    {
        var today = TimeZoneInfo.ConvertTime(now, Amsterdam);
        var points = new List<RainPoint>();
        foreach (var line in body.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (line.Split('|') is not [var value, var clock]
                || !int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var intensity)
                || !TimeOnly.TryParseExact(clock, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var at))
                continue;
            var local = today.Date + at.ToTimeSpan();
            if (local - today.DateTime > TimeSpan.FromHours(12)) local = local.AddDays(-1);
            else if (today.DateTime - local > TimeSpan.FromHours(12)) local = local.AddDays(1);
            var rate = intensity <= 0 ? 0 : Math.Round(Math.Pow(10, (intensity - 109) / 32.0), 2);
            points.Add(new RainPoint(new DateTimeOffset(local, Amsterdam.GetUtcOffset(local)), rate));
        }
        return points.Count > 0 ? points : null;
    }

    private static JsonElement[] Column(JsonElement section, string name) => section.GetProperty(name).EnumerateArray().ToArray();

    // A gap in a column is null; it counts as nothing.
    private static double Number(JsonElement section, string name, int? index = null)
    {
        var value = index is { } i ? section.GetProperty(name)[i] : section.GetProperty(name);
        return value.ValueKind == JsonValueKind.Number ? value.GetDouble() : 0;
    }
}
