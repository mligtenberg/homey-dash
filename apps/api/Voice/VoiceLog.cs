using System.Text.Json.Nodes;

namespace HomeyDash.Api.Voice;

/// <summary>One thing HomeyDash did for a spoken command: a capability set in Homey, or a timer; and whether it went through.</summary>
public sealed record VoiceStep(string? Device, string? Name, string What, object? Value, bool Ok, string? Error = null);

/// <summary>
/// What became of one thing a screen heard: the text the voice service made of it, what it understood, and what
/// HomeyDash then did in Homey. <see cref="Outcome"/> says how far it got:
/// <c>ignored</c> (not said to the screen), <c>heard</c> (said to it, but no command came of it yet), <c>understood</c>
/// (being carried out), <c>done</c>,
/// <c>refused</c> (the voice service understood no command it can do), <c>failed</c> (understood, but Homey did not do
/// it), <c>silent</c> (the wake word, and then nothing) and <c>unreachable</c> (no voice service).
/// </summary>
public sealed class VoiceLogEntry
{
    public Guid Id { get; } = Guid.NewGuid();
    public required DateTimeOffset At { get; init; }
    public required Guid Screen { get; init; }
    public string? Display { get; init; }
    public string? Zone { get; init; }
    public string Outcome { get; set; } = "heard";
    public string? Text { get; set; }
    public bool Wake { get; set; }
    public bool Armed { get; set; }
    public int? SttMs { get; set; }
    /// <summary>The command as the voice service read it, with the wake word taken off.</summary>
    public string? Command { get; set; }
    public string? Action { get; set; }
    public JsonNode? Value { get; set; }
    public JsonNode? Zones { get; set; }
    /// <summary>What the voice service asked for: device, name, zone, capability and value (a <c>_delta</c> is a step).</summary>
    public JsonNode? Asked { get; set; }
    public string? Reason { get; set; }
    public string? Detail { get; set; }
    public List<VoiceStep> Steps { get; set; } = [];
}

/// <summary>
/// The last things the screens heard and what was done with them, for Management to show: without it, a command that
/// was understood wrongly, or not carried out, looks the same on the screen as one that was never heard. Kept in memory
/// only, and only the last <see cref="Capacity"/>.
/// </summary>
public sealed class VoiceLog
{
    public const int Capacity = 50;

    private readonly LinkedList<VoiceLogEntry> _entries = new();

    public VoiceLogEntry Add(VoiceLogEntry entry)
    {
        lock (_entries)
        {
            _entries.AddFirst(entry);
            if (_entries.Count > Capacity) _entries.RemoveLast();
        }
        return entry;
    }

    /// <summary>Newest first.</summary>
    public IReadOnlyList<VoiceLogEntry> Recent()
    {
        lock (_entries) return [.. _entries];
    }

    public void Clear()
    {
        lock (_entries) _entries.Clear();
    }
}

/// <summary>Writes what one screen's socket to the voice service brings into the <see cref="VoiceLog"/>: an entry for each thing heard.</summary>
public sealed class VoiceSessionLog(VoiceLog log, Func<string, VoiceLogEntry> entry)
{
    private VoiceLogEntry? _last;

    public void Unreachable(string message) => log.Add(entry("unreachable")).Detail = message;

    /// <summary>The screen heard the wake word and opened the socket, and then nothing came that the voice service took for speech.</summary>
    public void Closed()
    {
        if (_last is null) log.Add(entry("silent"));
    }

    /// <summary>An event of the voice service: something it heard starts an entry, a result says what it made of it.</summary>
    public void Said(JsonNode node)
    {
        switch (node["type"]?.GetValue<string>())
        {
            case "heard":
                var wake = node["wake"]?.GetValue<bool>() == true;
                var armed = node["armed"]?.GetValue<bool>() == true;
                _last = log.Add(entry(wake || armed ? "heard" : "ignored"));
                _last.Text = node["text"]?.GetValue<string>();
                _last.Wake = wake;
                _last.Armed = armed;
                _last.SttMs = node["stt_ms"]?.GetValue<int>();
                break;
            case "result":
                _last ??= log.Add(entry("heard"));
                _last.Command = node["command_text"]?.GetValue<string>();
                _last.Action = node["action"]?.GetValue<string>();
                _last.Value = node["value"]?.DeepClone();
                _last.Zones = node["zones"]?.DeepClone();
                _last.Asked = node["commands"]?.DeepClone();
                _last.Reason = node["reason"]?.GetValue<string>();
                _last.Outcome = node["ok"]?.GetValue<bool>() == true ? "understood" : "refused";
                break;
        }
    }

    /// <summary>How the result that was just understood went in Homey.</summary>
    public void CarriedOut(JsonNode result, List<VoiceStep> steps)
    {
        if (_last is not { Outcome: "understood" }) return;
        _last.Steps = steps;
        _last.Outcome = result["ok"]?.GetValue<bool>() == true ? "done" : "failed";
        _last.Reason = result["reason"]?.GetValue<string>();
        _last.Detail = result["detail"]?.GetValue<string>();
    }
}
