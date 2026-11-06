using System.Net;

namespace HomeyDash.AirPlay;

/// <summary>An AirPlay receiver on the network. Id is its device id (its MAC address), which stays the same across restarts.</summary>
public sealed record Receiver(string Id, string Name, IPAddress Address, int Port, string Kind, string Model)
{
    public const string Tv = "tv", Speaker = "speaker", Computer = "computer";

    /// <summary>tv takes video (the AirPlay video feature flag), so an Apple TV; computer is a Mac; speaker is everything else.</summary>
    public static string KindOf(string? model, string? features)
    {
        if (model is not null && (model.StartsWith("Mac", StringComparison.Ordinal) || model.StartsWith("iMac", StringComparison.Ordinal))) return Computer;
        return Video(features) ? Tv : Speaker;
    }

    // features is "0x4A7FDFD5,0x3C155FDE": the low 32 bits, then optionally the high; bit 0 is video.
    private static bool Video(string? features)
    {
        var low = features?.Split(',')[0].Trim();
        if (low is null || !low.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) return false;
        return uint.TryParse(low.AsSpan(2), System.Globalization.NumberStyles.HexNumber, null, out var bits) && (bits & 1) != 0;
    }
}
