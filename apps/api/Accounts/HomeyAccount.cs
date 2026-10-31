namespace HomeyDash.Api.Accounts;

/// <summary>
/// The Homey account (ADR-0007): where the Homey Pro is on the local network and its local API key. Set up in
/// Management and kept in the database; a home has at most one.
/// </summary>
public sealed record HomeyAccount(string Address, string ApiKey)
{
    public const int SingleId = 1;

    public int Id { get; init; } = SingleId;
}

/// <summary>
/// The Homey account in use, or null while none is set up. Whoever connects to Homey reads it, and watches
/// <c>Replaced</c> to start over with the next one.
/// </summary>
public sealed class CurrentHomeyAccount
{
    private readonly Lock _lock = new();
    private HomeyAccount? _account;
    private CancellationTokenSource _replaced = new();

    public HomeyAccount? Account => _account;

    // The account, and a token that is cancelled once it is replaced or removed.
    public (HomeyAccount? Account, CancellationToken Replaced) Get()
    {
        lock (_lock) return (_account, _replaced.Token);
    }

    public void Set(HomeyAccount? account)
    {
        CancellationTokenSource replaced;
        lock (_lock)
        {
            replaced = _replaced;
            _account = account;
            _replaced = new CancellationTokenSource();
        }
        // Not disposed: a connection may still link to its token, and accounts change rarely.
        replaced.Cancel();
    }
}
