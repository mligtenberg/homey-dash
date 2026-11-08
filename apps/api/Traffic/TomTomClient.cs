using System.Globalization;
using System.Net;
using System.Text.Json;
using HomeyDash.Api.Weather;

namespace HomeyDash.Api.Traffic;

/// <summary>
/// Traffic from TomTom (tomtom.com/developers, a free tier with a key): the Routing API's live travel time with the
/// history's usual one, and the Search API to find places by name. See ADR-0015.
/// </summary>
public sealed class TomTomClient(IHttpClientFactory httpFactory) : ITraffic
{
    public const string HttpClientName = "TomTom";

    private const string Base = "https://api.tomtom.com";

    public static void ConfigureHttpClient(HttpClient http)
    {
        http.Timeout = TimeSpan.FromSeconds(15);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("HomeyDash");
    }

    public async Task CheckAsync(string apiKey, CancellationToken ct) =>
        await GetAsync($"{Base}/search/2/geocode/Amsterdam.json?limit=1&key={Uri.EscapeDataString(apiKey)}", ct);

    public async Task<RouteTime> RouteAsync(string apiKey, TrafficRoute route, CancellationToken ct)
    {
        var url = FormattableString.Invariant(
            $"{Base}/routing/1/calculateRoute/{route.Origin.Latitude:0.#####},{route.Origin.Longitude:0.#####}:{route.Destination.Latitude:0.#####},{route.Destination.Longitude:0.#####}/json")
            + $"?traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all&key={Uri.EscapeDataString(apiKey)}";
        return ParseRoute(await GetAsync(url, ct));
    }

    public async Task<IReadOnlyList<PlaceMatch>> SearchAsync(string apiKey, string query, string language, CancellationToken ct)
    {
        var url = $"{Base}/search/2/search/{Uri.EscapeDataString(query)}.json?limit=8&typeahead=true&language={Uri.EscapeDataString(Tag(language))}&key={Uri.EscapeDataString(apiKey)}";
        return ParsePlaces(await GetAsync(url, ct));
    }

    // TomTom wants language tags with a region.
    private static string Tag(string language) => language switch
    {
        "nl" => "nl-NL",
        "de" => "de-DE",
        "fr" => "fr-FR",
        "es" => "es-ES",
        _ => "en-GB",
    };

    // The Routing API's answer: the first route's summary. The usual time is the history's for this hour, else the free flow one.
    public static RouteTime ParseRoute(string body)
    {
        try
        {
            using var json = JsonDocument.Parse(body);
            var summary = json.RootElement.GetProperty("routes")[0].GetProperty("summary");
            var travel = summary.GetProperty("travelTimeInSeconds").GetInt32();
            var usual = Seconds(summary, "historicTrafficTravelTimeInSeconds") ?? Seconds(summary, "noTrafficTravelTimeInSeconds") ?? travel;
            var arrival = DateTimeOffset.Parse(summary.GetProperty("arrivalTime").GetString()!, CultureInfo.InvariantCulture);
            return new RouteTime(travel, usual, summary.GetProperty("lengthInMeters").GetInt32(), arrival);
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or IndexOutOfRangeException or FormatException)
        {
            throw new TrafficException("TomTom found no route between those places.", inner: e);
        }
    }

    private static int? Seconds(JsonElement summary, string name) =>
        summary.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : null;

    // The Search API's answer: a point of interest's name, else the street and number, else the place, with where it is.
    public static IReadOnlyList<PlaceMatch> ParsePlaces(string body)
    {
        try
        {
            using var json = JsonDocument.Parse(body);
            if (!json.RootElement.TryGetProperty("results", out var results)) return [];
            return results.EnumerateArray().Select(r =>
            {
                var address = r.GetProperty("address");
                var position = r.GetProperty("position");
                var street = Text(address, "streetName");
                var number = Text(address, "streetNumber");
                var name = (r.TryGetProperty("poi", out var poi) ? Text(poi, "name") : null)
                    ?? (street is null ? null : number is null ? street : $"{street} {number}")
                    ?? Text(address, "municipality") ?? Text(address, "freeformAddress") ?? "Place";
                var town = Text(address, "municipality");
                var region = Text(address, "countrySubdivision");
                return new PlaceMatch(
                    name, string.Join(", ", new[] { town == name ? null : town, region }.Where(s => s is not null)) is { Length: > 0 } detail ? detail : null,
                    Text(address, "country"), position.GetProperty("lat").GetDouble(), position.GetProperty("lon").GetDouble());
            }).ToList();
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            throw new TrafficException("TomTom's answer could not be read.", inner: e);
        }
    }

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString()) ? v.GetString() : null;

    private async Task<string> GetAsync(string url, CancellationToken ct)
    {
        try
        {
            var http = httpFactory.CreateClient(HttpClientName);
            using var response = await http.GetAsync(url, ct);
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                throw new TrafficException("TomTom doesn't accept that API key.", keyRefused: true);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
                throw new TrafficException("TomTom's limit for this key is reached.");
            if (response.StatusCode == HttpStatusCode.BadRequest)
                throw new TrafficException("TomTom found no route between those places.");
            if (!response.IsSuccessStatusCode) throw new TrafficException($"TomTom answered {(int)response.StatusCode}.");
            return await response.Content.ReadAsStringAsync(ct);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            throw new TrafficException("Cannot reach TomTom.", inner: e);
        }
    }
}
