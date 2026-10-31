using HomeyDash.Api.Homey;
using HomeyDash.Api.Photos;
using HomeyDash.Api.Plex;

namespace HomeyDash.Api.Dashboards;

/// <summary>What tiles can point at: things in Homey, photo sets (ADR-0008), and Plex's players and libraries (ADR-0009).</summary>
public sealed class TargetCatalog(HomeyState homey, PhotoSetIndex photoSets, PlexWatcher plex)
{
    public const string PlexPlayerPrefix = "plex-player:";
    public const string PlexLibraryPrefix = "plex-library:";
    public const string AnyPlexPlayer = PlexPlayerPrefix + "any";
    public const string AllPlexLibraries = PlexLibraryPrefix + "all";

    // Whether a target exists; null while that cannot be told, before Homey's or Plex's data first arrived.
    // Players come and go as they play, so one is never missing.
    public bool? Knows(string target) =>
        PhotoSet.TryParseTarget(target, out var id) ? photoSets.Contains(id)
        : target.StartsWith(PlexPlayerPrefix, StringComparison.Ordinal) || target == AllPlexLibraries ? true
        : target.StartsWith(PlexLibraryPrefix, StringComparison.Ordinal)
            ? plex.Overview.Loaded ? plex.Overview.Libraries.Any(l => PlexLibraryPrefix + l.Id == target) : null
        : homey.Loaded ? homey.Knows(target)
        : null;
}
