namespace HomeyDash.Api.Plex;

/// <summary>
/// Keeps the Plex server told what was watched here: the screen's own player, and what plays on an AirPlay receiver, neither of which
/// is a Plex client that reports itself. A report that fails is only logged; playing goes on.
/// </summary>
public sealed class PlexTimeline(PlexAccounts accounts, IPlex plex, ILogger<PlexTimeline> log)
{
    public async Task ReportAsync(int? accountId, string itemId, string state, long timeMs, long durationMs, CancellationToken ct = default)
    {
        if (accounts.For(accountId)?.Connection is not { } server) return;
        try
        {
            await plex.ReportAsync(server, itemId, state, Math.Max(0, timeMs), Math.Max(0, durationMs), ct);
        }
        catch (PlexException e)
        {
            log.LogWarning("Could not tell Plex about {Item}: {Message}", itemId, e.Message);
        }
    }
}
