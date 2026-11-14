using System.Text.Json;
using System.Text.Json.Nodes;
using HomeyDash.Api.Data;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Realtime;
using HomeyDash.Api.Timers;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.Voice;

/// <summary>
/// Carries out what the voice service made of a command: the changes in Homey, or the timer. The service only hears
/// and understands; nothing happens in the home until this runs. It answers the result with how it went. A timer
/// rings with <paramref name="timerSound"/>, the one set on the display it was asked for.
/// </summary>
public sealed class VoiceExecutor(Homeys homeys, HomeyDashDbContext db, RealtimeNotifier notifier, TimeProvider time, string? timerSound = null)
{
    /// <summary>
    /// The result as the screen should see it: unchanged when it was carried out in full, else a refusal saying how far it
    /// got. What was done, and whether each part went through, is added to <paramref name="steps"/>.
    /// </summary>
    public async Task<JsonNode> RunAsync(JsonNode result, CancellationToken ct, List<VoiceStep>? steps = null)
    {
        if (result["ok"]?.GetValue<bool>() != true) return result;
        steps ??= [];
        try
        {
            if (result["action"]?.GetValue<string>() == "timer") await SetTimerAsync(result["value"], steps, ct);
            else if (Commands(result) is { Count: > 0 } commands) return await ChangeAsync(result, commands, steps, ct);
        }
        catch (Exception e) when (e is HomeyNotFoundException or HomeyUnavailableException or ArgumentException or HttpRequestException or HubException)
        {
            return Refused(result, "Homey did not do it", e.Message);
        }
        return result;
    }

    private async Task SetTimerAsync(JsonNode? value, List<VoiceStep> steps, CancellationToken ct)
    {
        var seconds = value?["seconds"]?.GetValue<int>() ?? 0;
        var end = time.GetUtcNow().ToUnixTimeMilliseconds() + seconds * 1000L;
        var name = value?["name"]?.GetValue<string>();
        await TimerEndpoints.SaveAsync(db, new TimerView(Guid.NewGuid(), seconds, end, null, name, timerSound ?? "beep"), ct);
        await notifier.TimersChangedAsync(db, ct);
        steps.Add(new VoiceStep(null, name, "timer", seconds, true));
    }

    private async Task<JsonNode> ChangeAsync(JsonNode result, List<VoiceCommand> commands, List<VoiceStep> steps, CancellationToken ct)
    {
        var homey = homeys.Require(null); // the oldest account: the one the voice service's devices come from
        var changes = VoicePlan.Plan(commands, homey.State.FindDevice);
        var failures = new List<string>();
        void Did(VoiceChange change, string? error)
        {
            lock (steps) steps.Add(new VoiceStep(change.Device, homey.State.FindDevice(change.Device)?.Name, change.Capability, change.Value, error is null, error));
        }
        // One device's changes go in order (its mode before its temperature); the devices go at once.
        await Task.WhenAll(changes.GroupBy(c => c.Device).Select(async own =>
        {
            foreach (var change in own)
            {
                try
                {
                    await homey.SetCapabilityValueAsync(change.Device, change.Capability, JsonSerializer.SerializeToElement(change.Value), ct);
                    Did(change, null);
                }
                catch (Exception e) when (e is HomeyNotFoundException or HomeyUnavailableException or ArgumentException or HttpRequestException)
                {
                    Did(change, e.Message);
                    if (!change.Optional) lock (failures) failures.Add(e.Message);
                }
            }
        }));
        if (failures.Count == 0 && changes.Count > 0) return result;
        var wanted = changes.Count(c => !c.Optional);
        var through = wanted - failures.Count;
        return Refused(result, through > 0 ? $"Only {through} of {wanted} changes went through" : "Homey did not do it", failures.FirstOrDefault());
    }

    private static List<VoiceCommand> Commands(JsonNode result) =>
        result["commands"] is JsonArray array
            ? array.Select(c => new VoiceCommand(c!["device"]!.GetValue<string>(), c["capability"]!.GetValue<string>(),
                JsonSerializer.SerializeToElement(c["value"]))).ToList()
            : [];

    private static JsonNode Refused(JsonNode result, string reason, string? detail)
    {
        result["ok"] = false;
        result["reason"] = reason;
        result["detail"] = detail;
        return result;
    }
}
