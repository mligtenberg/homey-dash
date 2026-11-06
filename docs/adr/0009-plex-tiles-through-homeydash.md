# Plex tiles show what plays and what is new, through HomeyDash

Plex tiles come in their own tile module with three kinds: **Now playing** shows what plays on one Plex player, or on any, over its artwork, with buttons to skip back, play or pause, and skip on; **Recently added** shows the newest posters of one library or all; **Library** shows a library's newest films, series or albums and opens everything in it, alphabetically a page at a time (`PlexLibraryItems`). Someone signs in with Plex once, under Accounts; HomeyDash keeps the account's token and talks to the Plex server for every display. It looks at what plays every 3 seconds and at the libraries every 10 minutes, and pushes changes over the realtime connection. Displays get artwork through HomeyDash and never talk to Plex.

## Considered Options

- **Enter the server address and an X-Plex-Token by hand, like the Immich key.** Rejected: Plex hides its tokens, and a shared server has a token of its own. Plex's PIN sign-in needs no redirect address, so unlike Google's ([ADR-0008](0008-photos-from-immich-albums.md)) it works from any address Management is opened at.
- **Listen to the server's websocket notifications instead of polling.** Deferred: they only say that something changed, so HomeyDash would still ask the server what. A poll of the local server every 3 seconds is cheap, and tiles move progress on themselves between pushes.
- **Show continue watching (On Deck).** Not now; it fits the same module later.

## Consequences

- A home can have several Plex accounts, each with a name, such as one per server. HomeyDash watches each one's server. A Plex tile names its account in `settings.account`, or shows the oldest when it names none, so tiles made before there were several keep working. Signing an account in again keeps its id, and so its tiles; removing it makes them show Plex as not set up, and counts them as missing.
- Signing in opens Plex's own page in a new tab; HomeyDash checks every 2 seconds for up to 15 minutes whether someone approved it. An account with one server connects to it at once; with several, someone chooses in Accounts. HomeyDash tries the server's local addresses first, then remote ones, then Plex's relay.
- The buttons go through the server's `/player` API to the player. Only players that take remote control obey: Plex's own apps with **Advertise as player** turned on. Others refuse, and the tile flashes an error and says so in its detail view.
- A now-playing tile's target is `plex-player:any` or `plex-player:<machine id>`. Players only become known once they played something since HomeyDash started, so such a target is never missing. A recently-added or library tile's target is `plex-library:all` or `plex-library:<key>`, missing once the server no longer has that library.
- The image endpoint only serves the libraries' own pictures (`/library/metadata/…`), scaled by the server.
- Assistants can place Plex tiles over MCP ([ADR-0006](0006-mcp-server-for-assistants.md)), with players and libraries from `list_targets`.
