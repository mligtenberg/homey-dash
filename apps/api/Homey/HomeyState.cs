using System.Collections.Immutable;
using System.Text.Json;

namespace HomeyDash.Api.Homey;

/// <summary>
/// The last known state of everything in Homey, kept current by the Homey connection.
/// Reads never wait for Homey; when the connection is lost, the last known values stay.
/// </summary>
public sealed class HomeyState(TimeProvider time)
{
    private readonly Lock _lock = new();
    private ImmutableDictionary<string, HomeyDevice> _devices = ImmutableDictionary<string, HomeyDevice>.Empty;
    private ImmutableDictionary<string, HomeyFlow> _flows = ImmutableDictionary<string, HomeyFlow>.Empty;
    private ImmutableDictionary<string, HomeyMood> _moods = ImmutableDictionary<string, HomeyMood>.Empty;

    public event Action<HomeyChange>? Changed;

    public HomeyStatus Status { get; private set; } =
        new(HomeyConnection.Connecting, null, time.GetUtcNow(), Fake: false);

    public IEnumerable<HomeyDevice> Devices => _devices.Values;
    public IEnumerable<HomeyFlow> Flows => _flows.Values;
    public IEnumerable<HomeyMood> Moods => _moods.Values;

    public HomeyDevice? FindDevice(string id) => _devices.GetValueOrDefault(id);
    public HomeyFlow? FindFlow(string id) => _flows.GetValueOrDefault(id);
    public HomeyMood? FindMood(string id) => _moods.GetValueOrDefault(id);

    public HomeyCapability RequireSetableCapability(string deviceId, string capabilityId)
    {
        var device = FindDevice(deviceId) ?? throw new HomeyNotFoundException($"Device {deviceId} not found in Homey");
        var capability = device.Capabilities.GetValueOrDefault(capabilityId)
            ?? throw new HomeyNotFoundException($"Device {deviceId} has no capability {capabilityId}");
        return capability.Setable
            ? capability
            : throw new ArgumentException($"Capability {capabilityId} of device {deviceId} cannot be set");
    }

    public void SetStatus(HomeyConnection connection, string? lastError = null, bool fake = false)
    {
        HomeyStatus status;
        lock (_lock)
        {
            if (Status.Connection == connection && Status.LastError == lastError) return;
            status = Status = new HomeyStatus(connection, lastError, time.GetUtcNow(), fake);
        }
        Changed?.Invoke(new ConnectionChanged(status));
    }

    // Replaces everything with a fresh snapshot, raising a change for each device that differs.
    public void Replace(IEnumerable<HomeyDevice> devices, IEnumerable<HomeyFlow> flows, IEnumerable<HomeyMood> moods)
    {
        List<HomeyChange> changes = [];
        lock (_lock)
        {
            var next = devices.ToImmutableDictionary(d => d.Id);
            changes.AddRange(_devices.Keys.Where(id => !next.ContainsKey(id)).Select(id => new DeviceRemoved(id)));
            changes.AddRange(next.Values
                .Where(d => !_devices.TryGetValue(d.Id, out var old) || !SameDevice(old, d))
                .Select(d => new DeviceChanged(d)));
            _devices = next;
            _flows = flows.ToImmutableDictionary(f => f.Id);
            _moods = moods.ToImmutableDictionary(m => m.Id);
        }
        changes.Add(new CatalogChanged());
        foreach (var change in changes) Changed?.Invoke(change);
    }

    public void UpsertDevice(HomeyDevice device)
    {
        lock (_lock) _devices = _devices.SetItem(device.Id, device);
        Changed?.Invoke(new DeviceChanged(device));
    }

    public void RemoveDevice(string id)
    {
        lock (_lock)
        {
            if (!_devices.ContainsKey(id)) return;
            _devices = _devices.Remove(id);
        }
        Changed?.Invoke(new DeviceRemoved(id));
    }

    public void UpdateCapability(string deviceId, string capabilityId, JsonElement value, DateTimeOffset? at)
    {
        HomeyDevice updated;
        lock (_lock)
        {
            if (!_devices.TryGetValue(deviceId, out var device)
                || !device.Capabilities.TryGetValue(capabilityId, out var capability)) return;
            var capabilities = device.Capabilities.ToDictionary();
            capabilities[capabilityId] = capability with { Value = value.Clone(), LastUpdated = at ?? time.GetUtcNow() };
            updated = device with { Capabilities = capabilities };
            _devices = _devices.SetItem(deviceId, updated);
        }
        Changed?.Invoke(new DeviceChanged(updated));
    }

    public void UpsertFlow(HomeyFlow flow) => UpdateCatalog(() => _flows = _flows.SetItem(flow.Id, flow));
    public void RemoveFlow(string id) => UpdateCatalog(() => _flows = _flows.Remove(id));
    public void UpsertMood(HomeyMood mood) => UpdateCatalog(() => _moods = _moods.SetItem(mood.Id, mood));
    public void RemoveMood(string id) => UpdateCatalog(() => _moods = _moods.Remove(id));

    private void UpdateCatalog(Action update)
    {
        lock (_lock) update();
        Changed?.Invoke(new CatalogChanged());
    }

    private static bool SameDevice(HomeyDevice a, HomeyDevice b) =>
        a with { Capabilities = b.Capabilities } == b
        && a.Capabilities.Count == b.Capabilities.Count
        && a.Capabilities.All(kv => b.Capabilities.TryGetValue(kv.Key, out var other)
            && kv.Value with { Value = default } == other with { Value = default }
            && JsonElement.DeepEquals(kv.Value.Value, other.Value));
}
