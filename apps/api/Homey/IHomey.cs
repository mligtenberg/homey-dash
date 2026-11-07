using System.Text.Json;

namespace HomeyDash.Api.Homey;

// The Homey of one account: actions performed on it, and what it currently looks like in State.
public interface IHomey
{
    HomeyState State { get; }

    Task SetCapabilityValueAsync(string deviceId, string capabilityId, JsonElement value, CancellationToken ct);
    Task TriggerFlowAsync(string flowId, CancellationToken ct);
    Task ActivateMoodAsync(string moodId, CancellationToken ct);

    // Sonos multiroom (through the speaker's own flow actions in Homey). Speakers share a group when their
    // `sonos_group` capability is equal. Volume is 1-100 and applies to every speaker in the group.
    Task JoinSpeakerGroupAsync(string deviceId, string withDeviceId, CancellationToken ct);
    Task LeaveSpeakerGroupAsync(string deviceId, CancellationToken ct);
    Task SetGroupVolumeAsync(string deviceId, int volume, CancellationToken ct);

    // What a Sonos speaker can play: kind is a SpeakerMusicKinds value. Play takes an Item from the list; it plays in the
    // speaker's group.
    Task<IReadOnlyList<SpeakerMusic>> ListSpeakerMusicAsync(string deviceId, string kind, CancellationToken ct);
    Task PlaySpeakerMusicAsync(string deviceId, string kind, JsonElement item, CancellationToken ct);

    // The apps a device can open through its own "open an app" flow card (Apple TV, LG, Xbox); none when it has no such
    // card. Open takes an Item from the list.
    Task<IReadOnlyList<DeviceApp>> ListDeviceAppsAsync(string deviceId, CancellationToken ct);
    Task OpenDeviceAppAsync(string deviceId, JsonElement item, CancellationToken ct);

    Task<IReadOnlyList<HomeyInsightLog>> GetInsightLogsAsync(CancellationToken ct);

    // A picture Homey keeps, such as a device's album art; null when Homey has no such picture.
    Task<(byte[] Content, string ContentType)?> GetImageAsync(string imageId, CancellationToken ct);

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
