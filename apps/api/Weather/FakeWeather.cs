using HomeyDash.Api.Homey;

namespace HomeyDash.Api.Weather;

/// <summary>
/// A grey autumn day that clears up, with a shower coming in half an hour; for development and tests (Weather:Fake).
/// </summary>
public sealed class FakeWeather(TimeProvider time) : IWeatherSource
{
    private static readonly TimeZoneInfo Amsterdam = TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam");

    public Task<WeatherForecast> ForecastAsync(HomeyLocation location, CancellationToken ct)
    {
        var now = TimeZoneInfo.ConvertTime(time.GetUtcNow(), Amsterdam);
        var hour = new DateTimeOffset(now.Year, now.Month, now.Day, now.Hour, 0, 0, now.Offset);
        int[] hourCodes = [3, 3, 61, 80, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 1, 2, 3, 3, 45, 45, 3, 2, 1, 1];
        var hours = hourCodes.Select((code, i) =>
        {
            var at = hour.AddHours(i);
            var day = at.Hour is >= 8 and < 17;
            var temperature = Math.Round(8 + 3 * Math.Sin((at.Hour - 9) * Math.PI / 12), 1);
            var rain = code is 61 or 80 ? 0.8 : 0;
            return new WeatherHour(at, temperature, code, day, code is 61 or 80 ? 70 : code == 3 ? 20 : 5, rain);
        }).ToList();
        (int Code, double Low, double High, int Chance, double Sum)[] daily =
            [(61, 5.7, 11.2, 70, 2.4), (3, 4.0, 11.0, 10, 0), (63, 2.2, 9.2, 85, 6.1), (55, 6.2, 8.9, 70, 1.8), (80, 4.2, 7.3, 40, 0.6),
             (0, 3.3, 9.8, 5, 0), (71, -1.4, 3.9, 60, 1.2)];
        var days = daily.Select((d, i) =>
        {
            var date = DateOnly.FromDateTime(now.Date).AddDays(i);
            var midnight = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), now.Offset);
            return new WeatherDay(date, d.Code, d.Low, d.High, d.Chance, d.Sum, midnight.AddHours(7.75), midnight.AddHours(16.9));
        }).ToList();
        var current = new WeatherNow(hours[0].Temperature, hours[0].Temperature - 2.3, 3, hours[0].Day, 0.91, 11.2, 201, 0);
        return Task.FromResult(new WeatherForecast(current, hours, days));
    }

    private static readonly PlaceMatch[] Places =
    [
        new("Amsterdam", "North Holland", "Netherlands", 52.374, 4.890),
        new("Amersfoort", "Utrecht", "Netherlands", 52.155, 5.388),
        new("Amersfoort", "Mpumalanga", "South Africa", -27.009, 29.866),
        new("Antwerp", "Flanders", "Belgium", 51.221, 4.400),
        new("Barcelona", "Catalonia", "Spain", 41.389, 2.159),
    ];

    public Task<IReadOnlyList<PlaceMatch>> SearchAsync(string query, string language, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<PlaceMatch>>(
            Places.Where(p => p.Name.StartsWith(query.Trim(), StringComparison.OrdinalIgnoreCase)).ToList());

    // Dry, then a shower from half an hour on that peaks and passes. Like Buienradar, it only knows the Netherlands and Belgium.
    public Task<IReadOnlyList<RainPoint>?> RainAsync(HomeyLocation location, CancellationToken ct)
    {
        if (location.Latitude is < 49.5 or > 53.7 || location.Longitude is < 2.5 or > 7.3)
            return Task.FromResult<IReadOnlyList<RainPoint>?>(null);
        var now = time.GetUtcNow();
        var start = new DateTimeOffset(now.Ticks - now.Ticks % TimeSpan.FromMinutes(5).Ticks, TimeSpan.Zero);
        double[] rates = [0, 0, 0, 0, 0, 0, 0.1, 0.4, 1.2, 2.8, 3.5, 2.1, 0.9, 0.3, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        IReadOnlyList<RainPoint> rain = rates.Select((rate, i) => new RainPoint(start.AddMinutes(5 * i), rate)).ToList();
        return Task.FromResult<IReadOnlyList<RainPoint>?>(rain);
    }
}
