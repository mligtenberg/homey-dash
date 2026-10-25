using System.Text.Json;

namespace HomeyDash.Api.Homey;

// A Homey with a few sample devices, flows and moods, used when no Homey address is configured.
public sealed class FakeHomey(HomeyState state, TimeProvider time) : IHostedService, IHomey
{
    private static readonly JsonElement True = JsonSerializer.SerializeToElement(true);
    private static readonly JsonElement False = JsonSerializer.SerializeToElement(false);

    public Task StartAsync(CancellationToken ct)
    {
        state.Replace(
            [
                Device("living-lamp", "Reading lamp", "living", "Living room", "light",
                    OnOff(true), Number("dim", "Brightness", 0.8, null, true, 0, 1, 0.01)),
                Device("thermostat", "Thermostat", "living", "Living room", "thermostat",
                    Number("target_temperature", "Target temperature", 20.5, "°C", true, 5, 30, 0.5),
                    Number("measure_temperature", "Temperature", 20.1, "°C", false)),
                Device("front-door", "Front door", "hall", "Hall", "lock", Capability("locked", "Locked", "boolean", True, true)),
                Device("washer", "Washing machine", "utility", "Utility room", "washer", OnOff(false)),
                Device("p1-meter", "Energy meter", "utility", "Utility room", "sensor",
                    Number("measure_power", "Power", 1840, "W", false)),
            ],
            [new HomeyFlow("flow-goodnight", "Good night", Advanced: false, Enabled: true),
             new HomeyFlow("flow-leave", "Leaving home", Advanced: true, Enabled: true)],
            [new HomeyMood("mood-movie", "Movie night", "living"),
             new HomeyMood("mood-dinner", "Dinner", "living")]);
        state.SetStatus(HomeyConnection.Connected, fake: true);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;

    public Task SetCapabilityValueAsync(string deviceId, string capabilityId, JsonElement value, CancellationToken ct)
    {
        state.RequireSetableCapability(deviceId, capabilityId);
        state.UpdateCapability(deviceId, capabilityId, value, null);
        return Task.CompletedTask;
    }

    public Task TriggerFlowAsync(string flowId, CancellationToken ct) =>
        state.FindFlow(flowId) is null
            ? throw new HomeyNotFoundException($"Flow {flowId} not found in Homey")
            : Task.CompletedTask;

    public Task ActivateMoodAsync(string moodId, CancellationToken ct) =>
        state.FindMood(moodId) is null
            ? throw new HomeyNotFoundException($"Mood {moodId} not found in Homey")
            : Task.CompletedTask;

    public Task<IReadOnlyList<HomeyInsightLog>> GetInsightLogsAsync(CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<HomeyInsightLog>>(
        [
            new("homey:device:thermostat:measure_temperature", "homey:device:thermostat", "Thermostat", "Temperature", "number", "°C"),
            new("homey:device:p1-meter:measure_power", "homey:device:p1-meter", "Energy meter", "Power", "number", "W"),
        ]);

    // A smooth, repeatable curve per log, ending now.
    public async Task<IReadOnlyList<HomeyInsightEntry>> GetInsightEntriesAsync(string logId, string resolution, CancellationToken ct)
    {
        var logs = await GetInsightLogsAsync(ct);
        if (logs.All(l => l.Id != logId)) throw new HomeyNotFoundException($"Insight log {logId} not found in Homey");

        const int points = 60;
        var window = InsightResolutions.Window(resolution);
        var end = time.GetUtcNow();
        var power = logId.EndsWith(":measure_power");
        return Enumerable.Range(0, points)
            .Select(i =>
            {
                var t = end - window * (points - 1 - i) / (points - 1);
                var phase = (t - DateTimeOffset.UnixEpoch).TotalSeconds / window.TotalSeconds * 2 * Math.PI;
                var wave = Math.Sin(phase * 3) * 0.6 + Math.Sin(phase * 7) * 0.4;
                return new HomeyInsightEntry(t, Math.Round(power ? 1100 + wave * 900 : 20.5 + wave * 1.5, 1));
            })
            .ToList();
    }

    private static HomeyDevice Device(string id, string name, string zoneId, string zoneName, string @class,
        params HomeyCapability[] capabilities) =>
        new(id, name, zoneId, zoneName, @class, Available: true, UnavailableMessage: null,
            capabilities.ToDictionary(c => c.Id));

    private static HomeyCapability OnOff(bool on) => Capability("onoff", "Turned on", "boolean", on ? True : False, true);

    private static HomeyCapability Number(string id, string title, double value, string? units, bool setable,
        double? min = null, double? max = null, double? step = null) =>
        new(id, title, "number", JsonSerializer.SerializeToElement(value), units, setable, true, min, max, step, null);

    private static HomeyCapability Capability(string id, string title, string type, JsonElement value, bool setable) =>
        new(id, title, type, value, null, setable, true, null, null, null, null);
}
