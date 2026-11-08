using HomeyDash.Api.Accounts;

namespace HomeyDash.Api.Homey;

/// <summary>
/// Keeps a <see cref="LocalHomey"/> connected for every Homey account set up in Management (ADR-0007), and lists them in
/// <see cref="Homeys"/>. A new account connects, a removed one lets go, and one with another address or key connects
/// again; a rename only renames.
/// </summary>
public sealed class LocalHomeys(
    IHttpClientFactory httpFactory,
    HomeyAccounts accounts,
    Homeys homeys,
    TimeProvider time,
    ILoggerFactory loggers) : BackgroundService
{
    private sealed record Connection(LocalHomey Homey, CancellationTokenSource Stop, Task Running);

    private readonly Dictionary<int, Connection> _connections = [];
    private readonly SemaphoreSlim _accountsChanged = new(0);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        accounts.Changed += OnAccountsChanged;
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await ReconcileAsync(stoppingToken);
                await _accountsChanged.WaitAsync(stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        finally
        {
            accounts.Changed -= OnAccountsChanged;
            await Task.WhenAll(_connections.Values.Select(StopAsync));
        }
    }

    private void OnAccountsChanged() => _accountsChanged.Release();

    private async Task ReconcileAsync(CancellationToken stoppingToken)
    {
        var current = accounts.All;
        foreach (var (id, connection) in _connections.ToList())
        {
            var account = current.FirstOrDefault(a => a.Id == id);
            if (account is not null && (account.Address, account.ApiKey) == (connection.Homey.Account.Address, connection.Homey.Account.ApiKey))
                continue;
            _connections.Remove(id);
            await StopAsync(connection);
        }

        foreach (var account in current)
        {
            // Same address and key: only the name may differ, which the connection doesn't use.
            if (_connections.ContainsKey(account.Id)) continue;
            // Connecting again to the same account keeps what is known of its Homey until the new snapshot arrives.
            var state = homeys.Find(account.Id)?.State ?? new HomeyState(time, account.Id);
            var homey = new LocalHomey(httpFactory, account, state, time, loggers.CreateLogger<LocalHomey>());
            var stop = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            _connections[account.Id] = new Connection(homey, stop, homey.RunAsync(stop.Token));
        }

        homeys.Set(current.Select(a => new Homeys.Entry(a.Id, a.Name, _connections[a.Id].Homey)));
    }

    private static async Task StopAsync(Connection connection)
    {
        await connection.Stop.CancelAsync();
        await connection.Running;
        connection.Stop.Dispose();
    }
}
