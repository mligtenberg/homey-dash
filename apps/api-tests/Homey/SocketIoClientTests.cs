using System.Diagnostics;
using HomeyDash.Api.Homey;

namespace HomeyDash.Api.Tests.Homey;

public sealed class SocketIoClientTests : IAsyncLifetime
{
    private readonly ScriptedHomeyServer _server = new();

    public Task InitializeAsync() => _server.StartAsync();

    [Fact]
    public async Task ALostConnection_FailsPendingRequestsAtOnce()
    {
        await using var client = await SocketIoClient.ConnectAsync(_server.Address, CancellationToken.None);
        var watch = Stopwatch.StartNew();
        var pending = client.EmitWithAckAsync("/", "never-answered", [], CancellationToken.None);

        _server.DropConnection();

        await Assert.ThrowsAnyAsync<Exception>(() => pending);
        Assert.True(watch.Elapsed < SocketIoClient.RequestTimeout / 2, $"Took {watch.Elapsed}");
    }

    public async Task DisposeAsync() => await _server.DisposeAsync();
}
