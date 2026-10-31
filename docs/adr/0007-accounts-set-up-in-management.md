# Accounts are set up in Management, and fakes run only when asked for

HomeyDash holds the sign-ins it needs for the home, its accounts: the Homey local API key, the address and API key of the home's Immich server, and the Plex sign-in. They are set up in an Accounts section in Management and stored in the database, not in the backend's configuration. A fake Homey, Immich or Plex runs only when the configuration switches it on (`Homey:Fake`, `Immich:Fake`, `Plex:Fake`), for development and tests. A missing account never falls back to a fake.

## Considered Options

- **Keep the Homey address and key in configuration, as before.** Rejected: accounts are set up and checked while HomeyDash runs, without editing files and restarting it, and photo accounts belong next to Homey's.
- **Fall back to FakeHomey when no address is configured, as before.** Rejected: a real install with a typo or a missing key would quietly show made-up devices instead of telling anyone that Homey is not set up.

## Consequences

- The backend switches its Homey connection while it runs, instead of choosing `LocalHomey` or `FakeHomey` once at startup.
- Until Homey is set up, displays show Connection lost and Management says Homey is not set up yet. A setup wizard may replace this later.
- An existing install that had Homey in its configuration sets it up once in Accounts.
- The Immich API key is write-only, like the Homey key. HomeyDash checks a new address and key with Immich before it keeps them ([ADR-0008](0008-photos-from-immich-albums.md)).
- With no authentication ([ADR-0001](0001-trust-the-home-network.md)), anyone who can open Management can use the accounts through HomeyDash. The backend never sends a key or token to a browser, so they cannot be read out.
