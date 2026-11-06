using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using HomeyDash.AirPlay;

namespace HomeyDash.Api.AirPlay;

/// <summary>
/// Plays on Apple TVs with the HomeyDash.AirPlay library (ADR-0012): finds receivers, keeps what pairing leaves, and holds one
/// playback session per receiver while it plays. Where receivers were last seen is kept too, so a paired one is offered and
/// connected to at once while the network is searched for where it is now.
/// </summary>
public sealed class NativeAirPlay(AirPlayOptions options, ILogger<NativeAirPlay> log) : IAirPlay, IDisposable
{
    private static readonly TimeSpan ScanFor = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(20);

    public event Action<string>? Ended;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConcurrentDictionary<string, Receiver> _known = [];
    private readonly Dictionary<string, Player> _players = [];
    private readonly Dictionary<string, Pairing> _pairings = [];
    private readonly object _scanLock = new();
    private Task? _scan;
    private DateTime _scannedAt = DateTime.MinValue;
    private bool _loaded;

    // How receivers are looked for; the tests have none on the network.
    internal Func<TimeSpan, CancellationToken, Task<IReadOnlyList<Receiver>>> Scan { get; set; } = Discovery.ScanAsync;

    public async Task<IReadOnlyList<AirPlayDevice>> DevicesAsync(CancellationToken ct)
    {
        LoadKnown();
        if (Stale) await SearchNetwork().WaitAsync(ct);
        var credentials = ReadCredentials();
        return _known.Values.OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase)
            .Select(r => new AirPlayDevice(r.Id, r.Name, r.Kind, credentials.ContainsKey(r.Id))).ToList();
    }

    public async Task<IReadOnlyList<AirPlayDevice>> PairedAsync(CancellationToken ct)
    {
        LoadKnown();
        var paired = ReadCredentials().Keys.ToList();
        // Looking is started for the play that follows, and not waited for unless there is nothing yet to offer.
        var search = Stale ? SearchNetwork() : null;
        if (search is not null && paired.Any(id => !_known.ContainsKey(id))) await search.WaitAsync(ct);
        return paired.Where(_known.ContainsKey).Select(id => _known[id]).OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase)
            .Select(r => new AirPlayDevice(r.Id, r.Name, r.Kind, true)).ToList();
    }

    public async Task PlayAsync(string deviceId, string url, CancellationToken ct)
    {
        LoadKnown();
        await _gate.WaitAsync(ct);
        try
        {
            EndSession(deviceId);
            var credentials = ReadCredentials().GetValueOrDefault(deviceId) is { } text
                ? Credentials.Parse(text)
                : throw new AirPlayException("Pair the Apple TV first, under Accounts in Management.");
            var uri = new Uri(url);
            log.LogInformation("Playing {Origin}{Path} on {Device}", uri.GetLeftPart(UriPartial.Authority), uri.AbsolutePath, deviceId);

            var player = await ConnectAsync(deviceId, credentials, ct);
            try
            {
                await player.PlayAsync(url, 0, ct);
            }
            catch
            {
                player.Dispose();
                throw;
            }
            _players[deviceId] = player;
            // The session ends on its own when the TV stops or finishes; forget it then.
            _ = player.Ended.ContinueWith(async _ => await Forget(deviceId, player), TaskScheduler.Default);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task StopAsync(string deviceId, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            EndSession(deviceId);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task SetPausedAsync(string deviceId, bool paused, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (!_players.TryGetValue(deviceId, out var player)) throw new AirPlayException("Nothing is playing on that Apple TV.");
            await player.SetPausedAsync(paused, ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task PairStartAsync(string deviceId, CancellationToken ct)
    {
        LoadKnown();
        var receiver = _known.GetValueOrDefault(deviceId) ?? await FindAfterSearchAsync(deviceId, ct);
        await _gate.WaitAsync(ct);
        try
        {
            if (_pairings.Remove(deviceId, out var earlier)) earlier.Dispose();
            _pairings[deviceId] = await Pairing.StartAsync(receiver, ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task PairFinishAsync(string deviceId, string pin, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (!_pairings.Remove(deviceId, out var pairing)) throw new AirPlayException("Start pairing first.");
            using (pairing)
            {
                var credentials = await pairing.FinishAsync(pin, ct);
                var all = ReadCredentials();
                all[deviceId] = credentials.ToString();
                WriteJson(options.CredentialsPath, all);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    // Connects to where the receiver was last seen while the network is searched for where it is now; if the old place is
    // wrong (the address changed, the receiver is off) the search says so.
    private async Task<Player> ConnectAsync(string deviceId, Credentials credentials, CancellationToken ct)
    {
        void Log(string message) => log.LogDebug("AirPlay {Device}: {Message}", deviceId, message);
        if (_known.GetValueOrDefault(deviceId) is not { } seen) return await Player.ConnectAsync(await FindAfterSearchAsync(deviceId, ct), credentials, Log, ct);

        var search = Stale ? SearchNetwork() : null;
        try
        {
            return await Player.ConnectAsync(seen, credentials, Log, ct);
        }
        catch (AirPlayException) when (!ct.IsCancellationRequested)
        {
            var current = await FindAfterSearchAsync(deviceId, ct, search);
            return await Player.ConnectAsync(current, credentials, Log, ct);
        }
    }

    private async Task<Receiver> FindAfterSearchAsync(string deviceId, CancellationToken ct, Task? running = null)
    {
        await (running ?? SearchNetwork()).WaitAsync(ct);
        return _known.GetValueOrDefault(deviceId) ?? throw new AirPlayException("That receiver isn't on the network.");
    }

    private bool Stale => DateTime.UtcNow - _scannedAt >= CacheFor;

    // One search at a time, shared by whoever wants the result.
    private Task SearchNetwork()
    {
        lock (_scanLock)
        {
            if (_scan is { IsCompleted: false }) return _scan;
            return _scan = RunSearch();
        }
    }

    private async Task RunSearch()
    {
        IReadOnlyList<Receiver> found;
        try
        {
            found = await Scan(ScanFor, CancellationToken.None);
        }
        catch (Exception e) when (e is System.Net.Sockets.SocketException or IOException)
        {
            throw new AirPlayException("HomeyDash could not look for Apple TVs on the network.", e);
        }
        // A receiver that didn't answer this time is kept: mDNS answers get lost now and then.
        foreach (var receiver in found) _known[receiver.Id] = receiver;
        _scannedAt = DateTime.UtcNow;
        SaveKnown();
    }

    private void EndSession(string deviceId)
    {
        if (_players.Remove(deviceId, out var player)) player.Dispose();
    }

    private async Task Forget(string deviceId, Player player)
    {
        await _gate.WaitAsync();
        try
        {
            var wasCurrent = _players.TryGetValue(deviceId, out var current) && current == player;
            if (wasCurrent) _players.Remove(deviceId);
            player.Dispose();
            if (wasCurrent) Ended?.Invoke(deviceId);
        }
        finally
        {
            _gate.Release();
        }
    }

    // ---- what pairing left: receiver id to credentials text, in a JSON file ----

    private Dictionary<string, string> ReadCredentials()
    {
        try
        {
            return File.Exists(options.CredentialsPath)
                ? JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(options.CredentialsPath)) ?? []
                : [];
        }
        catch (JsonException)
        {
            throw new AirPlayException("The saved AirPlay pairings could not be read.");
        }
    }

    // ---- where receivers were last seen, next to the pairings ----

    private sealed record Seen(string Name, string Kind, string Model, string Address, int Port);

    private string KnownPath => Path.Combine(Path.GetDirectoryName(Path.GetFullPath(options.CredentialsPath)) ?? "",
        Path.GetFileNameWithoutExtension(options.CredentialsPath) + "-receivers.json");

    private void LoadKnown()
    {
        lock (_scanLock)
        {
            if (_loaded) return;
            _loaded = true;
        }
        try
        {
            if (!File.Exists(KnownPath)) return;
            foreach (var (id, seen) in JsonSerializer.Deserialize<Dictionary<string, Seen>>(File.ReadAllText(KnownPath)) ?? [])
                if (IPAddress.TryParse(seen.Address, out var address)) _known.TryAdd(id, new Receiver(id, seen.Name, address, seen.Port, seen.Kind, seen.Model));
        }
        catch (Exception e) when (e is JsonException or IOException)
        {
            log.LogWarning(e, "The AirPlay receivers seen before could not be read; searching the network instead");
        }
    }

    private void SaveKnown()
    {
        try
        {
            WriteJson(KnownPath, _known.ToDictionary(k => k.Key, k => new Seen(k.Value.Name, k.Value.Kind, k.Value.Model, k.Value.Address.ToString(), k.Value.Port)));
        }
        catch (IOException e)
        {
            log.LogWarning(e, "The AirPlay receivers seen could not be saved");
        }
    }

    private static void WriteJson<T>(string path, T value)
    {
        path = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(value));
    }

    public void Dispose()
    {
        foreach (var player in _players.Values) player.Dispose();
        foreach (var pairing in _pairings.Values) pairing.Dispose();
        _players.Clear();
        _pairings.Clear();
        _gate.Dispose();
    }
}
