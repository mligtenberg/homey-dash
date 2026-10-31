using HomeyDash.Api.Homey;
using HomeyDash.Api.Photos;
using HomeyDash.Api.Plex;

namespace HomeyDash.Api.Dashboards;

/// <summary>What tiles can point at: things in Homey, photo sets (ADR-0008), and Plex's players and libraries (ADR-0009).</summary>
public sealed class TargetCatalog(Homeys homeys, PhotoSetIndex photoSets, PlexWatcher plex)
{
    public const string PlexPlayerPrefix = "plex-player:";
    public const string PlexLibraryPrefix = "plex-library:";
    public const string AnyPlexPlayer = PlexPlayerPrefix + "any";
    public const string AllPlexLibraries = PlexLibraryPrefix + "all";

    // Whether a target exists in the tile's account (settings.account; null for the oldest of its kind); null while
    // that cannot be told, such as before Homey's or Plex's data first arrived.
    public bool? Knows(string target, int? account = null) =>
        PhotoSet.TryParseTarget(target, out var id) ? photoSets.Contains(id)
        : target.StartsWith(PlexPlayerPrefix, StringComparison.Ordinal) || target.StartsWith(PlexLibraryPrefix, StringComparison.Ordinal)
            ? KnowsPlex(target, account)
        : KnowsHomey(target, account);

    // As with Plex, a tile naming a removed account is missing.
    private bool? KnowsHomey(string target, int? account) =>
        homeys.For(account)?.State is not { } homey ? account is null ? null : false
        : homey.Loaded ? homey.Knows(target)
        : null;

    // A tile naming an account that was removed is missing. Players come and go as they play, so one is never missing.
    private bool? KnowsPlex(string target, int? account) =>
        plex.Overview(account) is not { } overview ? account is null ? null : false
        : target.StartsWith(PlexPlayerPrefix, StringComparison.Ordinal) || target == AllPlexLibraries ? true
        : overview.Loaded ? overview.Libraries.Any(l => PlexLibraryPrefix + l.Id == target)
        : null;
}
