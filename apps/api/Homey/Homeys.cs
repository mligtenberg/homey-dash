namespace HomeyDash.Api.Homey;

/// <summary>
/// The Homeys HomeyDash connects to, one per Homey account (ADR-0007), oldest account first. A Homey tile names its
/// account in settings.account; one that names none uses the oldest. <c>Changed</c> is raised when an account is added,
/// removed or renamed; what changes in a Homey is raised by its <see cref="HomeyState"/>.
/// </summary>
public sealed class Homeys
{
    // Name: the account's, for people to tell the Homeys apart.
    public sealed record Entry(int AccountId, string Name, IHomey Homey)
    {
        public HomeyState State => Homey.State;
    }

    private volatile IReadOnlyList<Entry> _all = [];

    public event Action? Changed;

    public IReadOnlyList<Entry> All => _all;

    public Entry? Find(int? accountId) => accountId is null ? null : _all.FirstOrDefault(e => e.AccountId == accountId);

    // The tile's account (settings.account), or the oldest when it names none.
    public Entry? For(int? accountId) => accountId is null ? _all.FirstOrDefault() : Find(accountId);

    // The Homey of a tile's account, to act on; throws while there is none.
    public IHomey Require(int? accountId) =>
        For(accountId)?.Homey ?? throw (accountId is null
            ? new HomeyUnavailableException("Homey is not set up yet. Add a Homey under Accounts.")
            : new HomeyNotFoundException($"There is no Homey account {accountId}."));

    public void Set(IEnumerable<Entry> entries)
    {
        _all = entries.OrderBy(e => e.AccountId).ToList();
        Changed?.Invoke();
    }
}
