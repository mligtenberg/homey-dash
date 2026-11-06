using HomeyDash.AirPlay;
using HomeyDash.Api.AirPlay;
using Microsoft.Extensions.Logging.Abstractions;

namespace HomeyDash.Api.Tests.AirPlay;

// What can be told without a receiver on the network; the protocol itself is tested in libs/airplay-tests.
public class NativeAirPlayTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"airplay-{Guid.NewGuid()}.json");
    private readonly NativeAirPlay _airPlay;

    public NativeAirPlayTests() =>
        _airPlay = new NativeAirPlay(new AirPlayOptions { CredentialsPath = _path }, NullLogger<NativeAirPlay>.Instance)
        {
            Scan = (_, _) => Task.FromResult<IReadOnlyList<Receiver>>([]),
        };

    [Fact]
    public async Task Play_OnAReceiverThatWasNeverPaired_AsksToPairFirst()
    {
        var error = await Assert.ThrowsAsync<AirPlayException>(() => _airPlay.PlayAsync("B2:19:DD:A9:4C:0D", "http://x/y.m3u8", CancellationToken.None));

        Assert.Contains("Pair the Apple TV first", error.Message);
    }

    [Fact]
    public async Task FinishingAPairing_ThatWasNotStarted_SaysToStartIt()
    {
        var error = await Assert.ThrowsAsync<AirPlayException>(() => _airPlay.PairFinishAsync("B2:19:DD:A9:4C:0D", "1234", CancellationToken.None));

        Assert.Contains("Start pairing first", error.Message);
    }

    [Fact]
    public async Task Play_WithPairingsThatCannotBeRead_SaysSo()
    {
        File.WriteAllText(_path, "not json");

        var error = await Assert.ThrowsAsync<AirPlayException>(() => _airPlay.PlayAsync("B2:19:DD:A9:4C:0D", "http://x/y.m3u8", CancellationToken.None));

        Assert.Contains("could not be read", error.Message);
    }

    [Fact]
    public async Task Play_WithAPairingInTheFilePyatvWrote_GetsAsFarAsLookingForTheReceiver()
    {
        // pyatv kept {id: "ltpk:ltsk:receiver:client"} in this file, and so do we.
        File.WriteAllText(_path, "{\"B2:19:DD:A9:4C:0D\":\"0102:0304:0506:0708\"}");

        var error = await Assert.ThrowsAsync<AirPlayException>(() => _airPlay.PlayAsync("B2:19:DD:A9:4C:0D", "http://x/y.m3u8", CancellationToken.None));

        Assert.Contains("isn't on the network", error.Message);
    }

    private static Receiver Tv(string id, string name) => new(id, name, System.Net.IPAddress.Parse("192.168.1.23"), 7000, Receiver.Tv, "AppleTV14,1");

    private string ReceiversPath => Path.Combine(Path.GetDirectoryName(_path)!, Path.GetFileNameWithoutExtension(_path) + "-receivers.json");

    private void SavePairedAndSeen(params string[] ids)
    {
        File.WriteAllText(_path, "{" + string.Join(",", ids.Select(id => $"\"{id}\":\"0102:0304:0506:0708\"")) + "}");
        File.WriteAllText(ReceiversPath, "{" + string.Join(",", ids.Select(id =>
            $"\"{id}\":{{\"Name\":\"Living room\",\"Kind\":\"tv\",\"Model\":\"AppleTV14,1\",\"Address\":\"127.0.0.1\",\"Port\":1}}")) + "}");
    }

    [Fact]
    public async Task ThePairedReceivers_AreOfferedAtOnceFromWhereTheyWereLastSeen_WhileTheNetworkIsSearched()
    {
        SavePairedAndSeen("B2:19:DD:A9:4C:0D");
        var searching = new TaskCompletionSource<IReadOnlyList<Receiver>>();
        var scans = 0;
        _airPlay.Scan = (_, _) => { scans++; return searching.Task; };

        var paired = await _airPlay.PairedAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));

        var device = Assert.Single(paired);
        Assert.Equal("Living room", device.Name);
        Assert.True(device.Paired);
        Assert.Equal(1, scans);
        searching.SetResult([]);
    }

    [Fact]
    public async Task APairedReceiverNeverSeen_IsOfferedOnceTheSearchFindsIt()
    {
        File.WriteAllText(_path, "{\"B2:19:DD:A9:4C:0D\":\"0102:0304:0506:0708\"}");
        var searching = new TaskCompletionSource<IReadOnlyList<Receiver>>();
        _airPlay.Scan = (_, _) => searching.Task;

        var paired = _airPlay.PairedAsync(CancellationToken.None);
        await Task.Delay(100);
        Assert.False(paired.IsCompleted);
        searching.SetResult([Tv("B2:19:DD:A9:4C:0D", "Woonkamer")]);

        Assert.Equal("Woonkamer", Assert.Single(await paired.WaitAsync(TimeSpan.FromSeconds(5))).Name);
        Assert.True(File.Exists(ReceiversPath), "where it was seen is kept for next time");
    }

    [Fact]
    public async Task OnlyPairedReceivers_AreOffered_ButManagementSeesAll()
    {
        File.WriteAllText(_path, "{\"B2:19:DD:A9:4C:0D\":\"0102:0304:0506:0708\"}");
        _airPlay.Scan = (_, _) => Task.FromResult<IReadOnlyList<Receiver>>([Tv("B2:19:DD:A9:4C:0D", "Woonkamer"), Tv("3E:FF:AD:8B:E2:80", "Slaapkamer")]);

        var paired = await _airPlay.PairedAsync(CancellationToken.None);
        var all = await _airPlay.DevicesAsync(CancellationToken.None);

        Assert.Equal(["Woonkamer"], paired.Select(d => d.Name));
        Assert.Equal(["Slaapkamer", "Woonkamer"], all.Select(d => d.Name));
        Assert.Equal([false, true], all.Select(d => d.Paired));
    }

    [Fact]
    public async Task Play_ConnectsToTheLastSeenPlaceWhileSearching_AndSearchesAgainWhenThatFails()
    {
        // Nothing listens where it was last seen (loopback port 1), so that fails and the search is what's left.
        SavePairedAndSeen("B2:19:DD:A9:4C:0D");
        var searched = new TaskCompletionSource();
        _airPlay.Scan = async (_, _) => { await Task.Delay(50); searched.SetResult(); return []; };

        var error = await Assert.ThrowsAsync<AirPlayException>(() => _airPlay.PlayAsync("B2:19:DD:A9:4C:0D", "http://x/y.m3u8", CancellationToken.None));

        Assert.True(searched.Task.IsCompleted);
        Assert.Contains("Could not connect", error.Message);
    }

    public void Dispose()
    {
        _airPlay.Dispose();
        File.Delete(_path);
        File.Delete(ReceiversPath);
    }
}
