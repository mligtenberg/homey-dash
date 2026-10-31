# Implementation plan

Built in vertical slices; each ends with something that works and has tests. Domain language is in
[CONTEXT.md](CONTEXT.md), decisions in [docs/adr](docs/adr).

| Slice | Status |
| --- | --- |
| 0. Foundations | Done |
| 1. Homey connection | Done, verified against the real Homey Pro (2026-10-25) |
| 2. Dashboards, drafts and publishing | Done (API and api-client; UI comes in slice 3) |
| 3. Management editor | Done (first version) |
| 4. Displays and setup | Done |
| 5. Realtime and display status | Done |
| 6. Tile modules | Done |
| 7. Packaging | To do |

## Defaults

- SignalR for pushes from the API to displays.
- Dashboard versions (draft and published) stored as JSON documents in SQLite, so new tile kinds need no migration.
- The Homey address and API key are an account set up in Management → Accounts and kept in the database (ADR-0007);
  configuration only switches on the fake Homey (`Homey:Fake=true`).
- `lucide-angular` for icons.

## Done

### 0. Foundations

- Removed the scaffold: the placeholder `Tile` entity, its endpoints and migration, and the `nx-welcome` pages.
- README rewritten with the project map, Homey setup and how to run.
- `libs/layout`: the five tile sizes, `cellSize(height, rows)` (includes dashboard padding, gaps and section
  title, so a dashboard fills the height exactly), grid checks for out-of-bounds and overlap, CSS grid placement.
- `libs/tiles`: `TileKind`, `TileModule`, `provideTileModules()` and a `TileKindRegistry` that rejects duplicate kinds.
- `libs/api-client`: TypeScript mirrors of the Homey models and a `HomeyApi` service.

### 1. Homey connection

- `SocketIoClient`: a minimal Socket.IO v2 / Engine.IO v3 client (one WebSocket, several namespaces, events, acks,
  ping watchdog). Protocol taken from the official `homey-api` package.
- `LocalHomey`: pings for the Homey ID, does `handshakeClient` with the API key, joins the returned namespace,
  subscribes to `homey:manager:devices|flow|moods` and every `homey:device:<id>`, loads a REST snapshot, applies
  live events to `HomeyState`, and reconnects with backoff (1 s to 30 s). Performs actions: set capability, trigger
  flow or advanced flow, activate mood, list insight logs.
- `FakeHomey`: sample devices, flows and moods, used when `Homey:Fake` is true. Never a fallback.
- Endpoints under `/api/homey`: `status`, `devices`, `flows`, `moods`, `insights`,
  `PUT devices/{id}/capabilities/{cap}`, `POST flows/{id}/trigger`, `POST moods/{id}/activate`.
- 23 API tests, including the real client against `ScriptedHomeyServer`.
- Verified on the real Homey Pro (firmware 13.5.3): handshake, namespace, subscriptions and live `capability`
  events; 116 devices, 33 flows, 24 moods and 427 insight logs load. Live events checked on 2026-10-25: a flow
  created, renamed, turned off and deleted reached HomeyDash; `device.update` carries the full device (renaming
  the Papagaai lamp and back kept its capabilities, values and zone); renaming the Hemels dag mood and back showed
  in HomeyDash (checked by Martin, as the connector cannot rename moods).

### 2. Dashboards, drafts and publishing

- `Dashboard` (`apps/api/Dashboards`): name, a draft and at most one published version, `publishedVersion`
  (counts publishes, 0 = never; for display status in slice 5) and `publishedAt`.
- A version is a `DashboardLayout` JSON document: `rows` (default 4, 1 to 12) and sections, each with tiles
  (`id`, `kind`, `size`, `position`, `settings`). Rows live in the version, not on the dashboard, so changing
  them in the draft cannot break the published layout. Tile settings are stored without being interpreted.
- `DashboardValidator`: tiles inside the grid, no overlap, known size, unique section and tile ids, a kind.
  Problems come back as a 400 validation problem keyed like `sections[0].tiles[1]`.
- First EF migration `AddDashboards` (one table; versions in text columns).
- Endpoints under `/api/dashboards`: list, get, create, `PATCH` rename, delete, `PUT {id}/draft`,
  `POST {id}/publish`. `hasUnpublishedChanges` compares the draft with the published version.
- `DashboardsApi` and the dashboard types in `libs/api-client`, reusing `TileSize` and `TilePosition` from `libs/layout`.
- 42 API tests (19 new).

### 3. Management editor

- `libs/tiles`: `TileData` (what tiles read from Homey), `TileHost` (places a tile and renders its kind, or an
  "Unknown tile" when no module registers the kind), `DashboardView` (sections as a display shows them), and
  `CORE_TILES` with basic device, flow, mood and statistic kinds. Shared settings are `{ target, label }`.
- Icons from `@lucide/angular` (the signal-based successor of `lucide-angular`, which does not support Angular 22).
- Management shell: sidebar with dashboards, "Draft" pill, new dashboard; collapses to a strip below 860px.
- Editor (`apps/management/src/app/editor`): `hd-stage` with real tiles under an overlay, `hd-slot` for empty
  cells, kind chooser, drag to move (also between sections), drag the handle to resize to the closest
  supported size, arrow keys to move and Delete to remove. Invalid moves are refused. Sections can be added,
  renamed, reordered and removed. Panel: target picker fed by `/api/homey/*` (devices as `Name — Zone`),
  label, size picker, Remove tile; with nothing selected, name, rows and Delete dashboard.
- The draft saves itself 400 ms after each edit, one save at a time. Unpublished changes pill, **Publish**
  (disabled without changes) and **Preview** (`/dashboards/:id/preview`, fitted to the window with `cellSize`).
- Draft edits are pure functions in `draft-edits.ts` with 12 unit tests; a Shell test covers the sidebar.

### 4. Displays and setup

- `Display` (`apps/api/Displays`): permanent id, name, assigned dashboard, and the `screenId` of the screen that
  holds it. The screen keeps only its own screen id in localStorage (`homeydash.screen`, made with
  `getRandomValues` because `randomUUID` needs a secure context and displays run over plain http).
  `GET /api/screens/{screenId}` tells a screen which display it is and the published version it shows; a 404
  sends it to setup. So takeover just moves the display to the new screen id, and the previous screen finds out
  on its next request.
- Endpoints under `/api/displays`: list, setup (`POST`, name and screen id), `POST {id}/takeover`, `PATCH` rename,
  `PUT {id}/dashboard` (only a published dashboard, or null to wait), delete. A screen holds at most one display.
- Deleting a dashboard sets its displays back to waiting (foreign key with `SET NULL`). Migration `AddDisplays`.
- Display app: setup (new display with a name, or take over one from a list with a confirm step), waiting state
  with the display's name, and the published dashboard fitted with `cellSize`. It polls every 10 s until realtime
  in slice 5; when the API cannot be reached it keeps what it shows, adds `is-connection-lost` and "Reconnecting…".
- Management: Displays in the sidebar; per display a name field, a dashboard picker (unpublished dashboards
  disabled) and Remove display (its screen returns to setup).
- `RestTileData` moved to `libs/tiles` so both apps use it. `.hd-dashboard` hides its scrollbar, which otherwise
  took height from the cells.
- `.claude/launch.json` runs separate instances for Claude (API on 5212 with `api-fake` for FakeHomey, display on
  4300, Management on 4301; database and build output in `tmp/claude/`), so they don't collide with yours.
- 51 API tests (9 new), 4 display app tests. Checked in the browser: setup, waiting, assignment, takeover both
  ways, connection lost.

### 5. Realtime and display status

- `RealtimeHub` (SignalR, `/api/realtime`), one connection per app. Every connection gets Homey's changes
  (`DeviceChanged`, `DeviceRemoved`, `Catalog`, `HomeyStatus`, passed on by `HomeyBroadcaster`) and can ask for a
  `Homey` snapshot and perform `SetCapability`, `TriggerFlow` and `ActivateMood` (failures come back as `HubException`).
- A screen calls `JoinScreen` with its screen id and gets its `ScreenView` (null: setup); afterwards `Screen` is pushed
  whenever it changes: setup, takeover (the previous screen gets null), rename, assignment, removal, and publishing
  or deleting its dashboard. Publishing therefore switches every display on the dashboard at once. The screen
  reports what it shows with `Showing(version)`.
- Display status: `DisplayPresence` counts open connections per screen (so it follows a takeover); `LastSeenAt` and
  `ShownVersion` are stored on the display (migration `AddDisplayStatus`; reset on takeover and reassignment).
  Management calls `JoinManagement` and gets `Displays` with every display's `DisplayStatus` (connected, held,
  last seen, shown and latest version). REST display endpoints return the same `DisplayInfo`.
- `libs/api-client`: `Realtime`, which reconnects forever (0 s to 30 s) and runs `whenConnected` callbacks after every
  reconnect, so state is loaded again and a version published while a display was cut off is picked up.
- `libs/tiles`: `RealtimeTileData` replaces `RestTileData` in both apps: a snapshot on each connect, changes in
  between (changes arriving while a snapshot loads are applied after it). Insight logs still load over REST.
- Display app: no more polling. Connection lost when the realtime connection is down or HomeyDash's Homey connection
  is `disconnected`: tiles desaturated and blocked (horizontal scroll still works), "Reconnecting…" pill.
- Management displays page: Connected / Last seen … / Never connected / No screen, and "Shows version x of y" when a
  display is behind. Delete dashboard now names the displays that will go back to waiting.
- Socket.IO requests to Homey fail as soon as the connection drops instead of waiting for their 10 s timeout.
- `libs/tiles` has a unit-test target (`@angular/build:unit-test`, borrowing `display:build:development`).
- Both apps' proxy configs pass WebSockets through (`ws: true`).
- Management's dashboard list follows `Dashboards`, pushed on create, rename, draft save, publish and delete, so
  changes from another Management window show up without a reload.
- A display reports `Showing` after the version is on screen (`afterNextRender`), and again after every reconnect.
- `FakeRealtime` in `@homey-dash/api-client/testing` stands in for the connection in the apps' specs.
- 59 API tests (8 new), 8 display app tests, 5 Management tests besides the draft edits, 2 tiles tests. Checked in the browser
  with FakeHomey: publish switches the display live, API stopped → connection lost → recovers on its own, Management
  status goes Connected → Last seen just now when the display closes, a rename in one Management window shows in
  another.

### 6. Tile modules

- Device tile: tap toggles `onoff`; wide and large tiles get inline controls (dim slider, thermostat +/− in steps
  of 0.5, cover Up/Stop/Down). The active state follows Homey only, never optimistic. A "Shows" setting picks the
  capability (Automatic: the first setable of onoff, dim, target_temperature, windowcoverings_state, else the first
  reading). A failed command shows "Did not respond".
- Flow and mood tiles: tap runs them; "Started" / "Activated" for 1.4 s after success, "Could not start" /
  "Could not activate" on failure.
- Statistic tile (large, full-large): `GET /api/homey/insights/entries?log=&resolution=` (LocalHomey splits the
  owner URI off the log id; FakeHomey generates 60 points), drawn as an SVG chart with live values appended from the
  owner device. A "Window" setting picks the resolution (default last 24 hours).
- Unavailable devices keep their last value, cannot be tapped and hide controls; missing targets show "Not found in
  Homey". Dashboard summaries carry `missingTiles` (draft tiles whose target Homey lacks, 0 until Homey loads);
  Management's sidebar shows the warning dot. The list is pushed again when devices, flows or moods change.
- Kinds can register a settings component (`TileKind.settings`), shown in the editor's tile panel. Preview is inert.
- FakeHomey's insight log ids now include the owner URI, like the real Homey's.
- Checked in the browser with FakeHomey: the lamp toggles, the thermostat + raises the target by 0.5, flow and mood
  show "Started" / "Activated" and clear, the chart draws and updates live, a missing target shows "Not found in
  Homey" and Management's sidebar flags the dashboard; the statistic settings show the time window.
- Against the real Homey (read-only, through the running instance): insight entries load for device logs,
  `energy_power` logs and Homey's own logs (`homey:manager:weather:temperature`), as 5-minute points.
- Tiles live on the real Homey (2026-10-25): the Papagaai lamp turned off on tap, the tile changing only when Homey
  reported it, and on again in about 150 ms (it came back at 27% instead of 39%, its own fade, so a dimmer's level
  is not kept across off and on). Moods Hemels dag and Hawaii avond activate, and flow tiles run their flows; Homey takes about 9 s to answer, so
  flow and mood tiles now confirm on press and switch to the error text if Homey refuses. Requests to Homey that
  perform an action may take 30 s (reads still give up after 10 s), so a slow mood no longer shows as failed. The heating statistic
  loads its history.
- Management with live Homey data: picking targets, moving and resizing, Publish and Preview work (checked by
  Martin, 2026-10-25).
- The Homey is addressed by its `.local` name instead of its IP, which had moved from .242 to .244 (README updated).
- Follow-ups: logs Homey keeps itself no longer count as missing; `energy_power` logs follow the device's
  `measure_power` live; statistic history reloads after a reconnect; the dashboard list push is coalesced (250 ms);
  the slider and segmented buttons get a 44 px touch area through a transparent border; Management's bundle
  budget is 600 kB (now 517 kB).
- 64 API tests (5 new), 16 tiles tests, 18 Management tests, 8 display tests, 11 layout tests.

### 6a. Accounts (ADR-0007)

- Management → Accounts sets up the Homey account (address and local API key), kept in the `HomeyAccounts` table.
  The key is write-only: no endpoint returns it. Addresses are accepted as typed (`192.168.1.10` → `http://…`).
- `LocalHomey` follows `CurrentHomeyAccount`: it waits while there is none (status `notSetUp`, which displays treat
  as connection lost) and starts over when the account changes or is removed.
- `Homey:Fake=true` runs FakeHomey; Accounts then shows it read-only. Launch configs and `serve -c simulator` set it.
- Management shows a "Homey isn't set up yet" banner and a warning dot on Accounts; the target picker says so too.
  Tiles show loading, not missing, until Homey's data first arrives (the snapshot carries `loaded`).
- After this change an install that had Homey in user-secrets sets it up once in Accounts; the secrets are unused.
- 87 API tests (8 new).

### 6c. Several dashboards per display

- A display has a main dashboard (`Display.DashboardId`) and other dashboards in `DisplayDashboards` (position and
  shown version per row; cascades from both sides; migration `AddOtherDisplayDashboards`). Others need a main one.
  Deleting a main dashboard makes the next one main, or the display waits.
- `PUT /api/displays/{id}/dashboard` and MCP `assign_dashboard` take `otherDashboardIds` (published only; the main one
  and repeats are dropped). `ScreenView.dashboards` lists them main first; `Showing` now takes a version per
  dashboard id, and `DisplayStatus.versions` reports shown and latest version per dashboard.
- Display app: the dashboard tape (`.hd-tape`), frosted pills floating over the left edge when it offers more than
  one, collapsible to one button (remembered per screen in `homeydash.tape`); a minute without a touch
  (`IDLE_MS`) returns it to the main one. Management: "Main dashboard" plus "Also on its tape" checkboxes, kept in
  dashboard list order.
- 136 API tests (4 new), 14 display app tests (5 new), 2 new Management displays page tests. Checked in the
  browser on the fake Homey.

### Open

- The local `apps/api/homey-dash.db` still has the empty `Tiles` table and the `InitialCreate` history row from the
  removed scaffold. Harmless; drop them (or delete the file, losing its dashboards) when convenient.
- The API does not check that a tile's size is supported by its kind: kinds are declared in front-end modules
  (ADR-0003), so Management checks that against the `TileKindRegistry`.
- No concurrency check on saving drafts (last write wins); fine while one person edits at a time.
- The segmented control's larger touch area is not seen in the browser yet (FakeHomey has no cover).

## To do

### 6b. Photo tile (ADR-0008)

- Google account in Accounts, signed in with the OAuth device flow (a code entered at Google's address); the refresh
  token stays in the `GoogleAccounts` table. The Google client (ID and secret) that registers HomeyDash with Google is
  entered in Accounts too and kept in the `GoogleClients` table; a different client signs the account out.
  `GooglePhotos:Fake=true` runs `FakeGooglePhotos` (12 SVG photos and a skipped video).
- Photo sets (`PhotoSets` table, photos as a JSON list) are made and filled in Management → Photo sets, or from a photo
  tile's panel. Picking opens the Google Photos Picker in a new tab; `PhotoPicking` polls the session, downloads the
  photos at most 2560 px into a staging folder and swaps them in, so a failed pick changes nothing. Files live under
  `Photos:Path` (default `apps/api/photos`), served at `/api/photos/{set}/{photo}` as immutable.
- A photo tile's target is `photo-set:<id>`; `TargetCatalog` tells Homey targets and photo sets apart for missing
  counts. Every change pushes `PhotoSets` to every connection; `RealtimeTileData` keeps them by target.
- Photo tile: every size, shuffled per tile, fades every 30 s (setting), pauses while the connection is lost, detail
  view with the photo whole, its date, arrows and swipe. The design system notes it as the one tile that moves.
- MCP: `list_homey_targets` is now `list_targets` with a `photoSet` type; `save_draft` describes the photo tile.
- 95 API tests (8 new), 43 tiles tests (7 new).
- Not tried against the real Google yet: needs a Google Cloud client. Google's device-flow scope list does not name
  the Picker scope (ADR-0008).

### 7. Packaging

- One container serving the API, the display app and Management on separate ports (ADR-0004).
- Reverse-proxy notes.
- Playwright e2e: set up a display, publish a dashboard, see the display update.
