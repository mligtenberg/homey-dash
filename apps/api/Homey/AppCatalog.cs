using System.Collections.Concurrent;
using System.Text.Json;

namespace HomeyDash.Api.Homey;

/// <summary>
/// Adds a category and an icon to the apps a device can open, which Homey names only by bundle id (`com.plexapp.plex`).
/// Both come from Apple's public iTunes lookup, so apps that are not in the App Store, such as Apple's own, get none
/// and stay as they are. What was found is kept until the process ends; a lookup that failed is tried again next time.
/// </summary>
public sealed class AppCatalog(IHttpClientFactory httpFactory, ILogger<AppCatalog> logger)
{
    public const string HttpClientName = "AppCatalog";

    // The store whose genre names and apps are asked for.
    private const string Country = "nl";
    private static readonly TimeSpan LookupTimeout = TimeSpan.FromSeconds(5);

    // Genres of apps for watching or listening, by the store's own (English) names.
    private static readonly HashSet<string> MediaGenres = new(["Entertainment", "Photo & Video", "Music", "Sports"], StringComparer.OrdinalIgnoreCase);

    private readonly ConcurrentDictionary<string, Task<AppInfo>> _found = new();

    private sealed record AppInfo(string? Category, string? Icon, bool Media);

    public async Task<IReadOnlyList<DeviceApp>> DescribeAsync(IReadOnlyList<DeviceApp> apps, CancellationToken ct) =>
        await Task.WhenAll(apps.Select(async app =>
        {
            if (app.Category is not null || BundleId(app) is not { } bundle) return app;
            try
            {
                var info = await LookUpAsync(bundle).WaitAsync(ct);
                return app with { Category = info.Category, Image = app.Image ?? info.Icon, Media = info.Media };
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException && !ct.IsCancellationRequested)
            {
                return app; // Without Apple's answer the app is shown as it is.
            }
        }));

    // Apps that are items with an id that looks like a bundle id.
    private static string? BundleId(DeviceApp app) =>
        app.Item.ValueKind == JsonValueKind.Object && HomeyMapper.String(app.Item, "id") is { } id && id.Contains('.') ? id : null;

    private Task<AppInfo> LookUpAsync(string bundle)
    {
        var lookup = _found.GetOrAdd(bundle, FetchAsync);
        // A failed lookup is not kept, so the next ask tries again.
        lookup.ContinueWith(t => _found.TryRemove(KeyValuePair.Create(bundle, lookup)), TaskContinuationOptions.OnlyOnFaulted);
        return lookup;
    }

    private async Task<AppInfo> FetchAsync(string bundle)
    {
        try
        {
            using var timeout = new CancellationTokenSource(LookupTimeout);
            var http = httpFactory.CreateClient(HttpClientName);
            var json = await http.GetFromJsonAsync<JsonElement>(
                $"https://itunes.apple.com/lookup?bundleId={Uri.EscapeDataString(bundle)}&country={Country}&lang={Country}_{Country}", timeout.Token);
            var app = json.TryGetProperty("results", out var results) && results.ValueKind == JsonValueKind.Array ? results.EnumerateArray().FirstOrDefault() : default;
            if (app.ValueKind != JsonValueKind.Object) return new AppInfo(Fallback(bundle), null, false);

            // `genres` names the same genres in the store's language, the first being the primary one.
            var genre = app.TryGetProperty("genres", out var genres) && genres.ValueKind == JsonValueKind.Array && genres.GetArrayLength() > 0
                ? genres[0].GetString()
                : HomeyMapper.String(app, "primaryGenreName");
            var icon = HomeyMapper.String(app, "artworkUrl100")?.Replace("100x100bb", "200x200bb");
            var primary = HomeyMapper.String(app, "primaryGenreName");
            return new AppInfo(genre ?? Fallback(bundle), icon, primary is not null && MediaGenres.Contains(primary));
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning("Could not look up the app {Bundle} at Apple: {Message}", bundle, e.Message);
            throw;
        }
    }

    // Apple's own apps are not in the store.
    private static string? Fallback(string bundle) => bundle.StartsWith("com.apple.", StringComparison.OrdinalIgnoreCase) ? "Apple" : null;
}
