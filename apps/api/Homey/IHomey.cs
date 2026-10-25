using System.Text.Json;

namespace HomeyDash.Api.Homey;

// Actions performed on Homey. What Homey currently looks like is read from HomeyState.
public interface IHomey
{
    Task SetCapabilityValueAsync(string deviceId, string capabilityId, JsonElement value, CancellationToken ct);
    Task TriggerFlowAsync(string flowId, CancellationToken ct);
    Task ActivateMoodAsync(string moodId, CancellationToken ct);
    Task<IReadOnlyList<HomeyInsightLog>> GetInsightLogsAsync(CancellationToken ct);
}

public sealed class HomeyOptions
{
    // For example http://192.168.1.10. Without it HomeyDash runs against FakeHomey.
    public string? Address { get; set; }

    // A local API key, created in the Homey web app under Settings → API keys.
    public string? ApiKey { get; set; }
}
