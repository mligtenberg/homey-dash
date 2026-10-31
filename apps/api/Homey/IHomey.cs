using System.Text.Json;

namespace HomeyDash.Api.Homey;

// The Homey of one account: actions performed on it, and what it currently looks like in State.
public interface IHomey
{
    HomeyState State { get; }

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

// The Homey section of the configuration. Which Homey to connect to is an account set up in Management (ADR-0007).
public sealed class HomeyOptions
{
    // Runs against FakeHomey instead of a real Homey, for development and tests. Never a fallback.
    public bool Fake { get; set; }
}
