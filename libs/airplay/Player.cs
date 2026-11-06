using System.Net;
using System.Security.Cryptography;
using HomeyDash.AirPlay.Crypto;
using HomeyDash.AirPlay.Protocol;

namespace HomeyDash.AirPlay;

/// <summary>
/// One playback session on a receiver: the paired and encrypted control connection, its event connection and the clock
/// service it asks for. PlayAsync starts a stream URL, which the receiver then fetches itself (the AirPlay 2 video
/// sequence tvOS 26 and later wants: a command stream, then queue and play commands). Disposing it ends the session.
/// </summary>
public sealed class Player : IDisposable
{
    private const string UserAgent = "AirPlay/550.10";
    private const string CommandUserAgent = "AirPlay/870.14.1";
    private const string RemoteControlClientType = "A6B27562-B43A-4F2D-B75F-82391E250194";
    private const string EndedEarly = "The receiver ended the session before playing. That is what it does when it cannot fetch or play the stream.";
    private static readonly TimeSpan FeedbackInterval = TimeSpan.FromSeconds(2);

    private readonly Connection _connection;
    private readonly byte[] _shared;
    private readonly Action<string>? _log;
    private readonly TimingServer _timing;
    private readonly CancellationTokenSource _stop = new();
    private readonly object _gate = new();
    private readonly TaskCompletionSource _ended = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private EventChannel? _events;
    private TaskCompletionSource _changed = new(TaskCreationOptions.RunContinuationsAsynchronously);

    private readonly string _sessionUuid = Guid.NewGuid().ToString().ToUpperInvariant();
    private readonly string _senderId = NewSenderId();
    private readonly uint _rtspSession = (uint)RandomNumberGenerator.GetInt32(int.MaxValue);
    private readonly string _dacpId = Convert.ToHexString(RandomNumberGenerator.GetBytes(8));
    private readonly uint _activeRemote = (uint)RandomNumberGenerator.GetInt32(int.MaxValue);
    private int _cseq;
    private long _streamId = -1;
    private string? _state;
    private string? _error;
    private Task? _feedback;

    private Player(Connection connection, byte[] shared, Action<string>? log)
    {
        _connection = connection;
        _shared = shared;
        _log = log;
        _timing = new TimingServer(connection.LocalAddress);
    }

    /// <summary>The playback state the receiver last reported (playing, paused, stopped, idle...), lower case; null before any.</summary>
    public string? State
    {
        get { lock (_gate) return _state; }
    }

    /// <summary>Completes when the session is over: the connection was lost, the receiver closed it or playback ended.</summary>
    public Task Ended => _ended.Task;

    public static async Task<Player> ConnectAsync(Receiver receiver, Credentials credentials, Action<string>? log, CancellationToken ct)
    {
        var connection = await Connection.ConnectAsync(receiver.Address, receiver.Port, ct);
        try
        {
            var shared = await PairVerify.RunAsync(connection, credentials, ct);
            connection.EnableEncryption(
                HapCrypto.Hkdf("Control-Salt", "Control-Write-Encryption-Key", shared),
                HapCrypto.Hkdf("Control-Salt", "Control-Read-Encryption-Key", shared));
            var player = new Player(connection, shared, log);
            try
            {
                await player.SetupAsync(receiver, ct);
                return player;
            }
            catch
            {
                player.Dispose();
                throw;
            }
        }
        catch
        {
            connection.Dispose();
            throw;
        }
    }

    private async Task SetupAsync(Receiver receiver, CancellationToken ct)
    {
        var response = await Rtsp("SETUP", null, BinaryPlist.Write(new Dictionary<string, object?>
        {
            ["deviceID"] = _senderId,
            ["sessionUUID"] = _sessionUuid,
            ["sessionCorrelationUUID"] = Guid.NewGuid().ToString().ToUpperInvariant(),
            ["timingPort"] = _timing.Port,
            ["timingProtocol"] = "NTP",
            ["isMultiSelectAirPlay"] = true,
            ["groupContainsGroupLeader"] = false,
            ["macAddress"] = _senderId,
            ["model"] = "iPhone14,3",
            ["name"] = "HomeyDash",
            ["osBuildVersion"] = "20F66",
            ["osName"] = "iPhone OS",
            ["osVersion"] = "16.5",
            ["senderSupportsRelay"] = false,
            ["sourceVersion"] = "690.7.1",
            ["statsCollectionEnabled"] = false,
        }), ct);
        var setup = BinaryPlist.ReadDictionary(response.Body);
        var eventPort = Convert.ToInt32(setup.GetValueOrDefault("eventPort") ?? 0);
        if (eventPort == 0) throw new AirPlayException("The receiver didn't offer an event connection.");

        _events = await EventChannel.ConnectAsync(receiver.Address, eventPort, _shared, OnEvent, OnEventsClosed, ct);
        _feedback = Task.Run(() => FeedbackAsync(_stop.Token));
    }

    /// <summary>Starts the stream and returns once the receiver reports it is playing; it throws if the receiver refuses or never starts.</summary>
    public async Task PlayAsync(string url, double startSeconds, CancellationToken ct)
    {
        await Rtsp("GET", "/info", null, ct, allowError: true);
        await Rtsp("RECORD", null, null, ct);
        var stream = await Rtsp("SETUP", null, BinaryPlist.Write(new Dictionary<string, object?>
        {
            ["streams"] = new List<object?>
            {
                new Dictionary<string, object?>
                {
                    ["clientUUID"] = Guid.NewGuid().ToString().ToUpperInvariant(),
                    ["clientTypeUUID"] = RemoteControlClientType,
                    ["channelID"] = $"{_senderId}-RCS-1",
                    ["controlType"] = 1,
                    ["type"] = 130,
                },
            },
        }), ct);
        var streams = BinaryPlist.ReadDictionary(stream.Body).GetValueOrDefault("streams") as List<object?>;
        if (streams?.FirstOrDefault() is not Dictionary<string, object?> first || !first.TryGetValue("streamID", out var id))
            throw new AirPlayException("The receiver didn't set up a stream for playback.");
        _streamId = Convert.ToInt64(id);

        var item = new Dictionary<string, object?>
        {
            ["uuid"] = Guid.NewGuid().ToString().ToUpperInvariant(),
            ["mediaType"] = "file",
            ["Content-Location"] = url,
            ["Start-Position-Seconds"] = startSeconds,
        };
        var commands = new[]
        {
            new Dictionary<string, object?> { ["type"] = "insertPlayQueueItem", ["item"] = item },
            new Dictionary<string, object?> { ["type"] = "setProperty", ["value"] = true, ["property"] = "isInterestedInDateRange", ["item"] = new Dictionary<string, object?> { ["uuid"] = item["uuid"] } },
            new Dictionary<string, object?> { ["type"] = "setProperty", ["value"] = 1, ["property"] = "actionAtItemEnd" },
            new Dictionary<string, object?> { ["type"] = "setRate", ["rate"] = 1.0 },
        };
        foreach (var command in commands)
        {
            var response = await Command(command, ct);
            if (response.Code is < 200 or >= 300)
                throw new AirPlayException($"The receiver refused the {command["type"]} command ({response.Code} {response.Message}).");
        }

        await WaitUntilPlayingAsync(ct);
    }

    /// <summary>Pauses (rate 0) or resumes (rate 1) what plays; only after PlayAsync.</summary>
    public async Task SetPausedAsync(bool paused, CancellationToken ct)
    {
        if (_streamId < 0) throw new AirPlayException("Nothing is playing on the receiver.");
        var response = await Command(new Dictionary<string, object?> { ["type"] = "setRate", ["rate"] = paused ? 0.0 : 1.0 }, ct);
        if (response.Code is < 200 or >= 300)
            throw new AirPlayException($"The receiver refused to {(paused ? "pause" : "resume")} ({response.Code} {response.Message}).");
    }

    private async Task WaitUntilPlayingAsync(CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct, _stop.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        while (true)
        {
            string? state;
            string? error;
            Task changed;
            lock (_gate)
            {
                state = _state;
                error = _error;
                changed = _changed.Task;
            }
            if (state == "playing") return;
            if (error is not null) throw new AirPlayException(error);
            if (_ended.Task.IsCompleted) throw new AirPlayException(EndedEarly);
            try
            {
                await changed.WaitAsync(timeout.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested && !_stop.IsCancellationRequested)
            {
                throw new AirPlayException($"The receiver did not start playing (it reports {state ?? "nothing"}).");
            }
        }
    }

    private Task<Response> Command(Dictionary<string, object?> command, CancellationToken ct)
    {
        var body = BinaryPlist.Write(new Dictionary<string, object?> { ["params"] = new Dictionary<string, object?> { ["data"] = BinaryPlist.Write(command) } });
        return Rtsp("POST", "/command", body, ct, protocol: "HTTP/1.1", allowError: true, extra: new Dictionary<string, string>
        {
            ["User-Agent"] = CommandUserAgent,
            ["X-Apple-ProtocolVersion"] = "1",
            ["X-Apple-Session-ID"] = _sessionUuid,
            ["X-Apple-StreamID"] = _streamId.ToString(),
        });
    }

    private Task<Response> Rtsp(string method, string? uri, byte[]? body, CancellationToken ct, bool allowError = false, string protocol = "RTSP/1.0", Dictionary<string, string>? extra = null)
    {
        var headers = new Dictionary<string, string>
        {
            ["CSeq"] = (Interlocked.Increment(ref _cseq) - 1).ToString(),
            ["DACP-ID"] = _dacpId,
            ["Active-Remote"] = _activeRemote.ToString(),
            ["Client-Instance"] = _dacpId,
        };
        if (body is not null) headers["Content-Type"] = "application/x-apple-binary-plist";
        if (extra is not null) foreach (var (key, value) in extra) headers[key] = value;
        // Requests with no path of their own are about the session, which RTSP names by URL.
        return _connection.SendAsync(method, uri ?? $"rtsp://{_connection.LocalAddress}/{_rtspSession}", protocol, headers, body, ct, allowError);
    }

    private void OnEvent(Dictionary<string, object?> payload)
    {
        _log?.Invoke("event " + string.Join(", ", payload.Select(p => p.Key + "=" + Describe(p.Value))));
        if (payload.GetValueOrDefault("type") as string != "playbackState") return;
        var parameters = payload.GetValueOrDefault("params") as Dictionary<string, object?>;
        var state = parameters?.GetValueOrDefault("playbackState") as string ?? payload.GetValueOrDefault("name") as string;
        if (state is null) return;
        Update(state.ToLowerInvariant());
    }

    private void Update(string state)
    {
        lock (_gate)
        {
            if (_state == state) return;
            var wasPlaying = _state == "playing";
            _state = state;
            var old = _changed;
            _changed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            old.TrySetResult();
            // After it played, idle or stopped is the end (it finished, or someone stopped it on the TV).
            if (wasPlaying && state is "idle" or "stopped") _ended.TrySetResult();
        }
    }

    private void OnEventsClosed()
    {
        lock (_gate)
        {
            _error ??= _state == "playing" ? null : EndedEarly;
            var old = _changed;
            _changed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            old.TrySetResult();
        }
        _ended.TrySetResult();
    }

    private async Task FeedbackAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Rtsp("POST", "/feedback", null, ct, allowError: true);
            }
            catch (Exception e) when (e is AirPlayException or OperationCanceledException)
            {
                // Feedback is best effort; a lost connection shows itself on the event connection.
                if (e is AirPlayException) _log?.Invoke("feedback failed: " + e.Message);
            }
            try
            {
                await Task.Delay(FeedbackInterval, ct);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private static string Describe(object? value) => value switch
    {
        Dictionary<string, object?> d => "{" + string.Join(", ", d.Select(p => p.Key + "=" + Describe(p.Value))) + "}",
        byte[] b => $"<{b.Length} bytes>",
        List<object?> l => "[" + string.Join(", ", l.Select(Describe)) + "]",
        _ => value?.ToString() ?? "null",
    };

    private static string NewSenderId()
    {
        var bytes = RandomNumberGenerator.GetBytes(6);
        bytes[0] = (byte)((bytes[0] & 0xFC) | 0x02);
        return string.Join(':', bytes.Select(b => b.ToString("X2")));
    }

    public void Dispose()
    {
        _stop.Cancel();
        _events?.Dispose();
        _timing.Dispose();
        _connection.Dispose();
        _ended.TrySetResult();
    }
}
