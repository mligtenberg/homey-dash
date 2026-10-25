# Implementation plan

Built in vertical slices; each ends with something that works and has tests. Domain language is in
[CONTEXT.md](CONTEXT.md), decisions in [docs/adr](docs/adr).

| Slice | Status |
| --- | --- |
| 0. Foundations | Done |
| 1. Homey connection | Done, verified against the real Homey Pro (2026-10-25) |
| 2. Dashboards, drafts and publishing | Done (API and api-client; UI comes in slice 3) |
| 3. Management editor | To do |
| 4. Displays and setup | To do |
| 5. Realtime and display status | To do |
| 6. Tile modules | To do |
| 7. Packaging | To do |

## Defaults

- SignalR for pushes from the API to displays.
- Dashboard versions (draft and published) stored as JSON documents in SQLite, so new tile kinds need no migration.
- Homey address and API key come from configuration (user-secrets or environment variables), never from Management.
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
- `FakeHomey`: sample devices, flows and moods, used when `Homey:Address` is empty.
- Endpoints under `/api/homey`: `status`, `devices`, `flows`, `moods`, `insights`,
  `PUT devices/{id}/capabilities/{cap}`, `POST flows/{id}/trigger`, `POST moods/{id}/activate`.
- 23 API tests, including the real client against `ScriptedHomeyServer`.

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

### Open from slices 0 to 2

- Verified on the real Homey Pro (firmware 13.5.3): handshake, namespace, subscriptions and live `capability`
  events work; 116 devices, 33 flows, 24 moods and 427 insight logs load. Not yet seen live: flow and mood
  events, and `device.update` (whether it carries the full device).
- Insight log ids include the owner URI (`homey:device:<id>:energy_power`); account for this when fetching entries in slice 6.
- Give the Homey a fixed IP (DHCP reservation): it moved from .242 to .244, which broke the configured address.
- Angular libraries have no unit-test runner (Nx needs them buildable or Analog for Vitest); add one when they get components.
- Pending socket acks wait for their 10 s timeout after a disconnect instead of failing at once.
- Delete the old local `apps/api/homey-dash.db`; it still has the removed `Tiles` table.
- The API does not check that a tile's size is supported by its kind: kinds are declared in front-end modules
  (ADR-0003), so Management checks that against the `TileKindRegistry` in slice 3.
- Deleting a dashboard does not yet consider displays; decide in slice 4 what happens to displays showing it.
- No concurrency check on saving drafts (last write wins); fine while one person edits at a time.

## To do

### 3. Management editor

- Sidebar and dashboard list.
- Editor canvas (`hd-stage`, fixed 92px cell) with an overlay on each tile: add, place, resize (size picker),
  configure and remove tiles; add and reorder sections.
- Target picker fed by `/api/homey/*`.
- Unpublished-changes indicator, **Publish**, and **Preview** fitted to the window.

### 4. Displays and setup

- `Display`: permanent GUID identity kept in the screen's localStorage, name, assigned dashboard.
- Setup: become a new display (give it a name) or take over an existing one; takeover sends the previous screen back to setup.
- Waiting state when no dashboard is assigned; only published dashboards can be assigned.

### 5. Realtime and display status

- SignalR hub: displays join with their identity, receive the published version and device state, and send actions.
- Publishing switches every display on that dashboard at once.
- Display status in Management: connected, last seen, on the latest version or not.
- Connection lost on displays: desaturated, taps blocked, horizontal scroll still works, "Reconnecting…" pill,
  picks up the latest published version on recovery.

### 6. Tile modules

- Device tile: lights and dimmers first, then other capabilities through inline controls.
- Flow and mood tiles: tap action, then "Started" or "Activated".
- Statistic tile: insights history with live updates.
- Unavailable and missing states; Management flags every dashboard with a missing tile.

### 7. Packaging

- One container serving the API, the display app and Management on separate ports (ADR-0004).
- Reverse-proxy notes.
- Playwright e2e: set up a display, publish a dashboard, see the display update.
