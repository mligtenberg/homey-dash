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

### Open from slices 0 to 4

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
- No concurrency check on saving drafts (last write wins); fine while one person edits at a time.
- Kind-specific settings (which capabilities a device tile shows, a statistic's time window) need a settings
  component per kind in `TileKind`; add it with the full tile modules in slice 6.
- The sidebar's warning dot for dashboards with missing tiles needs the API to know about targets; slice 6.
- Management reads Homey data by polling REST every 10 s; switch to the realtime connection in slice 5.
- Not yet checked in the browser with live Homey data: picking targets, moving and resizing, Publish and Preview.
- Displays poll REST for their dashboard and tile data; slice 5 replaces both with SignalR. Tiles on displays
  cannot be operated yet (slice 6).
- A display no screen holds any more (after its screen was given to another display) still shows in Management;
  display status in slice 5 will show it as never connected.
- The editor's Delete dashboard does not say which displays will go back to waiting.

## To do

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
