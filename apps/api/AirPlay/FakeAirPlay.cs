using HomeyDash.AirPlay;
using System.Collections.Concurrent;

namespace HomeyDash.Api.AirPlay;

/// <summary>Two made-up receivers, so screens can be tried without a TV. Remembers what it was told to play.</summary>
public sealed class FakeAirPlay : IAirPlay
{
    public const string LivingRoomTv = "fake-tv";

    private static readonly (string Id, string Name, string Kind)[] Known =
    [
        (LivingRoomTv, "Living room TV", "tv"),
        ("fake-bedroom", "Bedroom TV", "tv"),
        ("fake-speaker", "Kitchen speaker", "speaker"),
    ];

    // The receivers that were paired; the bedroom TV is not until someone does.
    private readonly ConcurrentDictionary<string, bool> _paired = new([new(LivingRoomTv, true), new("fake-speaker", true)]);

    private IReadOnlyList<AirPlayDevice> Devices => Known.Select(d => new AirPlayDevice(d.Id, d.Name, d.Kind, _paired.ContainsKey(d.Id))).ToList();

    public event Action<string>? Ended;

    /// <summary>Plays out the session of a receiver, as when it was stopped on the TV.</summary>
    public void EndOnReceiver(string deviceId)
    {
        Playing.TryRemove(deviceId, out _);
        Paused.TryRemove(deviceId, out _);
        Ended?.Invoke(deviceId);
    }

    // Device id to the url it plays.
    public ConcurrentDictionary<string, string> Playing { get; } = new();

    // Device ids that were paused.
    public ConcurrentDictionary<string, bool> Paused { get; } = new();

    public Task<IReadOnlyList<AirPlayDevice>> DevicesAsync(CancellationToken ct) => Task.FromResult(Devices);

    public Task<IReadOnlyList<AirPlayDevice>> PairedAsync(CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<AirPlayDevice>>(Devices.Where(d => d.Paired).ToList());

    public Task PlayAsync(string deviceId, string url, CancellationToken ct)
    {
        if (Known.All(d => d.Id != deviceId)) throw new AirPlayException("That receiver isn't on the network.");
        Playing[deviceId] = url;
        return Task.CompletedTask;
    }

    public Task PairStartAsync(string deviceId, CancellationToken ct) =>
        Known.Any(d => d.Id == deviceId) ? Task.CompletedTask : throw new AirPlayException("That receiver isn't on the network.");

    // Any four digits pair it.
    public Task PairFinishAsync(string deviceId, string pin, CancellationToken ct)
    {
        if (pin.Length != 4 || !pin.All(char.IsDigit)) throw new AirPlayException("The receiver didn't accept that PIN.");
        _paired[deviceId] = true;
        return Task.CompletedTask;
    }

    public Task SetPausedAsync(string deviceId, bool paused, CancellationToken ct)
    {
        if (!Playing.ContainsKey(deviceId)) throw new AirPlayException("Nothing is playing on that Apple TV.");
        if (paused) Paused[deviceId] = true;
        else Paused.TryRemove(deviceId, out _);
        return Task.CompletedTask;
    }

    public Task StopAsync(string deviceId, CancellationToken ct)
    {
        Playing.TryRemove(deviceId, out _);
        Paused.TryRemove(deviceId, out _);
        return Task.CompletedTask;
    }
}
