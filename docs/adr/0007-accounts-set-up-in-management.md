# Accounts are set up in Management, and fakes run only when asked for

HomeyDash holds the sign-ins it needs for the home, its accounts: for each Homey Pro, its address and local API key; for each Immich server, its address and API key; and for each Plex server, a Plex sign-in. A home can have several accounts of each kind, such as one Homey per house or one Immich per person. Each has a name that tells it apart from the others of its kind. Accounts are set up in an Accounts section in Management and stored in the database, not in the backend's configuration. A fake Homey, Immich or Plex runs only when the configuration switches it on (`Homey:Fake`, `Immich:Fake`, `Plex:Fake`), for development and tests. Each fake has exactly one account, which can't be changed. A missing account never falls back to a fake.

A tile on Homey or Plex names its account in `settings.account`. A tile that names none uses the oldest account of its kind, so a home with one account never needs to name it. A photo set names its Immich account itself ([ADR-0008](0008-photos-from-immich-albums.md)).

## Considered Options

- **Keep the Homey address and key in configuration, as before.** Rejected: accounts are set up and checked while HomeyDash runs, without editing files and restarting it, and photo accounts belong next to Homey's.
- **Fall back to FakeHomey when no address is configured, as before.** Rejected: a real install with a typo or a missing key would quietly show made-up devices instead of telling anyone that Homey is not set up.
- **One account of each kind.** Rejected: a home with a second house, or with family members who each have their own Immich or Plex, couldn't show them side by side.
- **Tell accounts apart by address.** Rejected: an address says nothing to the people in the home, and two accounts can share one server.

## Consequences

- The backend keeps one connection per Homey account and starts or stops them while it runs. A new address or key reconnects that Homey. A new name only renames it.
- Realtime messages about a Homey carry its account id, and commands to a Homey name one.
- When HomeyDash loses a Homey, only that Homey's tiles lock on displays. The Reconnecting pill shows while any Homey the shown dashboard has tiles of is lost. Until any Homey is set up, Homey tiles show Connection lost and Management says Homey is not set up yet.
- A tile naming a removed account counts as missing until it is given another account. Photo sets of a removed Immich account keep their photos, but displays can't show them until they're given another account.
- Missing-tile counting, the target pickers in Management and the MCP tools all work per account.
- An existing install that had Homey in its configuration sets it up once in Accounts. Its existing Homey, Immich and Plex accounts were named "Homey", "Immich" and "Plex" when several accounts arrived.
- The Immich API key is write-only, like the Homey key. HomeyDash checks a new address and key with Immich before it keeps them ([ADR-0008](0008-photos-from-immich-albums.md)).
- With no authentication ([ADR-0001](0001-trust-the-home-network.md)), anyone who can open Management can use the accounts through HomeyDash. The backend never sends a key or token to a browser, so they cannot be read out.
