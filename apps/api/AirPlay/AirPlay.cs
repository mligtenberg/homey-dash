using HomeyDash.AirPlay;

namespace HomeyDash.Api.AirPlay;

// Enabled turns AirPlay off when false. Fake runs against FakeAirPlay. CredentialsPath is the JSON file the pairings are kept in.
public sealed class AirPlayOptions
{
    public bool Enabled { get; set; } = true;
    public bool Fake { get; set; }
    public string CredentialsPath { get; set; } = "airplay-credentials.json";
}

// A receiver on the network. Kind is tv (takes video), speaker or computer; only a tv plays what Plex streams.
public sealed record AirPlayDevice(string Id, string Name, string Kind, bool Paired);

// What a screen gets: whether AirPlay is set up, and the receivers it found.
public sealed record AirPlayInfo(bool Available, IReadOnlyList<AirPlayDevice> Devices);

// What Management shows: whether AirPlay is on or faked, whether looking for receivers worked, and the receivers it found.
public sealed record AirPlayStatus(bool Configured, bool Fake, bool Reachable, string? Error, IReadOnlyList<AirPlayDevice> Devices);

/// <summary>Plays a stream on an AirPlay receiver (ADR-0012).</summary>
public interface IAirPlay
{
    // Raised with the receiver's id when its playback ended on its own: finished, or stopped on the TV.
    event Action<string>? Ended;

    // Every receiver on the network, paired or not; waits for the network to be searched when that is out of date.
    Task<IReadOnlyList<AirPlayDevice>> DevicesAsync(CancellationToken ct);

    // The receivers that are paired. Answers at once from what was seen before and searches in the background, so a screen
    // can offer them while PlayAsync finds where they are; it only waits when a paired receiver has never been seen.
    Task<IReadOnlyList<AirPlayDevice>> PairedAsync(CancellationToken ct);

    // Starts the stream the receiver fetches itself from url; returns once it was accepted.
    Task PlayAsync(string deviceId, string url, CancellationToken ct);

    Task StopAsync(string deviceId, CancellationToken ct);

    // Pauses or resumes what plays on the receiver.
    Task SetPausedAsync(string deviceId, bool paused, CancellationToken ct);

    // Gives the receiver a name of our own, shown in place of what it calls itself; an empty name goes back to that.
    Task RenameAsync(string deviceId, string? name, CancellationToken ct);

    // Makes the receiver show a PIN, which PairFinishAsync then takes; its credentials are kept for later.
    Task PairStartAsync(string deviceId, CancellationToken ct);

    Task PairFinishAsync(string deviceId, string pin, CancellationToken ct);
}
