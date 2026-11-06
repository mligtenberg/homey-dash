using HomeyDash.AirPlay.Protocol;

namespace HomeyDash.AirPlay.Tests;

// Runs the client against FakeReceiver over real sockets, so framing, encryption and the order of requests are all exercised.
public class SessionTests
{
    private static readonly TimeSpan Limit = TimeSpan.FromSeconds(20);

    [Fact]
    public async Task Pairing_WithTheRightPin_LeavesCredentialsThatVerifyAgain()
    {
        using var tv = new FakeReceiver();
        using var cts = new CancellationTokenSource(Limit);

        Credentials credentials;
        using (var pairing = await Pairing.StartAsync(tv.Receiver, cts.Token))
            credentials = await pairing.FinishAsync(FakeReceiver.Pin, cts.Token);

        // The text form is pyatv's, so a pairing made by it works here and the other way around.
        var restored = Credentials.Parse(credentials.ToString());
        using var player = await Player.ConnectAsync(tv.Receiver, restored, null, cts.Token);
        Assert.Contains("POST /pair-verify", tv.Requests);
    }

    [Fact]
    public async Task Pairing_WithAWrongPin_SaysTheReceiverDidNotAcceptIt()
    {
        using var tv = new FakeReceiver();
        using var cts = new CancellationTokenSource(Limit);
        using var pairing = await Pairing.StartAsync(tv.Receiver, cts.Token);

        var error = await Assert.ThrowsAsync<AirPlayException>(() => pairing.FinishAsync("0000", cts.Token));

        Assert.Contains("PIN", error.Message);
    }

    [Fact]
    public async Task Play_RunsTheTvOs26SequenceAndReturnsOnceTheReceiverIsPlaying()
    {
        using var tv = new FakeReceiver();
        var credentials = tv.PairedCredentials();
        using var cts = new CancellationTokenSource(Limit);
        using var player = await Player.ConnectAsync(tv.Receiver, credentials, null, cts.Token);

        await player.PlayAsync("http://192.168.1.2:32400/video/:/transcode/universal/start.m3u8?X-Plex-Token=t", 12.5, cts.Token);

        Assert.Equal("playing", player.State);
        // The base session first, then the playback: info, record, the command stream, four commands. Feedback runs alongside.
        var requests = tv.Requests.Where(r => !r.StartsWith("POST /feedback") && !r.StartsWith("POST /pair")).Select(r => r.StartsWith("SETUP") ? "SETUP" : r.StartsWith("RECORD") ? "RECORD" : r).ToList();
        Assert.Equal(["SETUP", "GET /info", "RECORD", "SETUP", "POST /command", "POST /command", "POST /command", "POST /command"], requests);
        Assert.Equal(["insertPlayQueueItem", "setProperty", "setProperty", "setRate"], tv.Commands.Select(c => (string)c["type"]!).ToList());
        var item = (Dictionary<string, object?>)tv.Commands[0]["item"]!;
        Assert.Equal("http://192.168.1.2:32400/video/:/transcode/universal/start.m3u8?X-Plex-Token=t", item["Content-Location"]);
        Assert.Equal(12.5, item["Start-Position-Seconds"]);
        Assert.Equal("file", item["mediaType"]);
        Assert.Equal(1.0, tv.Commands[3]["rate"]);
    }

    [Fact]
    public async Task Pause_SendsRateZeroAndResumeRateOne()
    {
        using var tv = new FakeReceiver();
        using var cts = new CancellationTokenSource(Limit);
        using var player = await Player.ConnectAsync(tv.Receiver, tv.PairedCredentials(), null, cts.Token);
        await Assert.ThrowsAsync<AirPlayException>(() => player.SetPausedAsync(true, cts.Token));
        await player.PlayAsync("http://x/y.m3u8", 0, cts.Token);

        await player.SetPausedAsync(true, cts.Token);
        await player.SetPausedAsync(false, cts.Token);

        var rates = tv.Commands.Where(c => (string)c["type"]! == "setRate").Select(c => c["rate"]).ToList();
        Assert.Equal([1.0, 0.0, 1.0], rates);
    }

    [Fact]
    public async Task Play_SaysSoWhenTheReceiverRefusesACommand()
    {
        using var tv = new FakeReceiver { RefuseCommands = true };
        using var cts = new CancellationTokenSource(Limit);
        using var player = await Player.ConnectAsync(tv.Receiver, tv.PairedCredentials(), null, cts.Token);

        var error = await Assert.ThrowsAsync<AirPlayException>(() => player.PlayAsync("http://x/y.m3u8", 0, cts.Token));

        Assert.Contains("insertPlayQueueItem", error.Message);
        Assert.Contains("500", error.Message);
    }

    [Fact]
    public async Task Play_SaysSoWhenTheReceiverEndsTheSessionInsteadOfPlaying()
    {
        using var tv = new FakeReceiver { ReportAfterPlay = null };
        using var cts = new CancellationTokenSource(Limit);
        using var player = await Player.ConnectAsync(tv.Receiver, tv.PairedCredentials(), null, cts.Token);

        var playing = player.PlayAsync("http://x/y.m3u8", 0, cts.Token);
        await Task.Delay(300);
        tv.Dispose();

        var error = await Assert.ThrowsAsync<AirPlayException>(() => playing);
        Assert.Contains("ended the session", error.Message);
    }

    [Fact]
    public async Task Ended_CompletesWhenTheReceiverStopsAfterPlaying()
    {
        using var tv = new FakeReceiver();
        using var cts = new CancellationTokenSource(Limit);
        using var player = await Player.ConnectAsync(tv.Receiver, tv.PairedCredentials(), null, cts.Token);
        await player.PlayAsync("http://x/y.m3u8", 0, cts.Token);
        Assert.False(player.Ended.IsCompleted);

        await tv.SendEventAsync("stopped");

        await player.Ended.WaitAsync(cts.Token);
    }

    [Fact]
    public async Task Connect_WithCredentialsOfAnotherReceiver_IsRefused()
    {
        using var tv = new FakeReceiver();
        var credentials = tv.PairedCredentials();
        var other = new Credentials(credentials.ReceiverPublicKey, credentials.PrivateKey, "SOMEONE-ELSE"u8.ToArray(), credentials.ClientId);
        using var cts = new CancellationTokenSource(Limit);

        var error = await Assert.ThrowsAsync<AirPlayException>(() => Player.ConnectAsync(tv.Receiver, other, null, cts.Token));

        Assert.Contains("not the receiver", error.Message);
    }
}
