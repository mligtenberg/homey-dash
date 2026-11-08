using HomeyDash.Api.Weather;

namespace HomeyDash.Api.Traffic;

/// <summary>
/// Always some traffic on the way: 25 minutes where 18 is usual (7 delay), for development and tests (Traffic:Fake).
/// A route that starts at the place named "Jam" is stuck for 45 minutes, one that starts at "Clear" runs at its usual time.
/// </summary>
public sealed class FakeTraffic(TimeProvider time) : ITraffic
{
    // The one account of a fake TomTom.
    public static TomTomAccount Account { get; } = new("fake-key") { Id = 1, Name = "TomTom" };

    public Task CheckAsync(string apiKey, CancellationToken ct) => Task.CompletedTask;

    public Task<RouteTime> RouteAsync(string apiKey, TrafficRoute route, CancellationToken ct)
    {
        var (travel, usual) = route.Origin.Name switch
        {
            "Jam" => (45 * 60, 18 * 60),
            "Clear" => (18 * 60, 18 * 60),
            _ => (25 * 60, 18 * 60),
        };
        return Task.FromResult(new RouteTime(travel, usual, 21_400, time.GetUtcNow().AddSeconds(travel)));
    }

    private static readonly PlaceMatch[] Places =
    [
        new("Amsterdam Centraal", "North Holland", "Netherlands", 52.379, 4.900),
        new("Amersfoort", "Utrecht", "Netherlands", 52.155, 5.388),
        new("Utrecht Science Park", "Utrecht", "Netherlands", 52.085, 5.177),
        new("Utrecht Centraal", "Utrecht", "Netherlands", 52.089, 5.110),
        new("Schiphol Airport", "North Holland", "Netherlands", 52.309, 4.764),
        new("Jam", "Utrecht", "Netherlands", 52.0, 5.0),
        new("Clear", "Utrecht", "Netherlands", 52.2, 5.2),
    ];

    public Task<IReadOnlyList<PlaceMatch>> SearchAsync(string apiKey, string query, string language, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<PlaceMatch>>(
            Places.Where(p => p.Name.StartsWith(query.Trim(), StringComparison.OrdinalIgnoreCase)).ToList());
}
