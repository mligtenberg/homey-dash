using System.Text.Json;

namespace HomeyDash.Api.Homey;

// Actions performed on Homey. What Homey currently looks like is read from HomeyState.
public interface IHomey
{
    Task SetCapabilityValueAsync(string deviceId, string capabilityId, JsonElement value, CancellationToken ct);
    Task TriggerFlowAsync(string flowId, CancellationToken ct);
    Task ActivateMoodAsync(string moodId, CancellationToken ct);
    Task<IReadOnlyList<HomeyInsightLog>> GetInsightLogsAsync(CancellationToken ct);

    // Entries of one insight log, oldest first. Resolution is one of InsightResolutions.
    Task<IReadOnlyList<HomeyInsightEntry>> GetInsightEntriesAsync(string logId, string resolution, CancellationToken ct);
}

public static class InsightResolutions
{
    public static readonly IReadOnlyList<string> All = ["lastHour", "last24Hours", "last7Days", "last31Days"];

    public static TimeSpan Window(string resolution) => resolution switch
    {
        "lastHour" => TimeSpan.FromHours(1),
        "last24Hours" => TimeSpan.FromHours(24),
        "last7Days" => TimeSpan.FromDays(7),
        "last31Days" => TimeSpan.FromDays(31),
        _ => throw new ArgumentException($"Unknown resolution {resolution}"),
    };
}

public sealed class HomeyOptions
{
    // For example http://192.168.1.10. Without it HomeyDash runs against FakeHomey.
    public string? Address { get; set; }

    // A local API key, created in the Homey web app under Settings → API keys.
    public string? ApiKey { get; set; }
}
