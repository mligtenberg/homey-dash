using System.Text.Json;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Voice;

namespace HomeyDash.Api.Tests.Voice;

public class VoicePlanTests
{
    private static HomeyCapability Cap(JsonElement value, double? min = null, double? max = null, double? step = null) =>
        new("c", "c", "number", value, null, true, true, min, max, step, null);

    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);

    private static HomeyDevice Device(string id, params (string Id, HomeyCapability Cap)[] caps) =>
        new(id, id, null, null, "light", true, null, caps.ToDictionary(c => c.Id, c => c.Cap));

    private static readonly Dictionary<string, HomeyDevice> Devices = new()
    {
        ["lamp"] = Device("lamp", ("onoff", Cap(Json(false))), ("dim", Cap(Json(0.2))), ("light_temperature", Cap(Json(0.9), 0, 1)), ("light_mode", Cap(Json("color")))),
        ["heater"] = Device("heater", ("target_temperature", Cap(Json(20), 5, 21, 0.5))),
    };

    private static IReadOnlyList<VoiceChange> Plan(string device, string capability, object value) =>
        VoicePlan.Plan([new VoiceCommand(device, capability, Json(value))], id => Devices.GetValueOrDefault(id));

    [Fact]
    public void ADimmedLight_IsTurnedOn()
    {
        Assert.Equal([new VoiceChange("lamp", "dim", 0.5), new VoiceChange("lamp", "onoff", true)], Plan("lamp", "dim", 0.5));
    }

    [Fact]
    public void AStep_BecomesANewValue_WithinWhatTheDeviceAllows()
    {
        Assert.Equal([new VoiceChange("heater", "target_temperature", 21.0)], Plan("heater", "target_temperature_delta", 1.0));
    }

    [Fact]
    public void ALightStep_PutsTheLightInTemperatureMode_First()
    {
        Assert.Equal([new VoiceChange("lamp", "light_mode", "temperature", Optional: true), new VoiceChange("lamp", "light_temperature", 1.0)],
            Plan("lamp", "light_temperature_delta", 0.2));
    }

    [Fact]
    public void AStep_OnADeviceItHasNoValueOf_IsLeftOut()
    {
        Assert.Empty(Plan("ghost", "target_temperature_delta", 1.0));
    }
}
