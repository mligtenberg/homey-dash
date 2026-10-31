namespace HomeyDash.Api.Accounts;

/// <summary>
/// A Homey account (ADR-0007): where a Homey Pro is on the local network and its local API key, under a name that
/// tells a home's Homeys apart. Set up in Management and kept in the database.
/// </summary>
public sealed record HomeyAccount(string Address, string ApiKey)
{
    public int Id { get; init; }

    public string Name { get; init; } = "Homey";
}

/// <summary>
/// The Homey accounts set up, oldest first. Whoever connects to Homey reads them, and watches <c>Changed</c> to connect
/// to new ones and let go of removed ones.
/// </summary>
public sealed class HomeyAccounts
{
    private volatile IReadOnlyList<HomeyAccount> _all = [];

    public event Action? Changed;

    public IReadOnlyList<HomeyAccount> All => _all;

    public HomeyAccount? Find(int? id) => id is null ? null : _all.FirstOrDefault(a => a.Id == id);

    public void Set(IEnumerable<HomeyAccount> accounts)
    {
        _all = accounts.OrderBy(a => a.Id).ToList();
        Changed?.Invoke();
    }
}
