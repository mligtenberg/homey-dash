# Implementation plan

Built in vertical slices; each ends with something that works and has tests. Domain language is in
[CONTEXT.md](CONTEXT.md), decisions in [docs/adr](docs/adr).

| Slice | Status |
| --- | --- |
| 0. Foundations | Done |
| 1. Homey connection | Done, not yet verified against a real Homey Pro |
| 2. Dashboards, drafts and publishing | To do |
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

### Open from slices 0 and 1

- Run against the real Homey Pro and check the log (`Connected to Homey … N devices`, then
  `Homey event homey:device:… capability` when a light is switched). Likely differences from the scripted server:
  flow and mood event names, and whether `device.update` carries the full device.
- Angular libraries have no unit-test runner (Nx needs them buildable or Analog for Vitest); add one when they get components.
- Pending socket acks wait for their 10 s timeout after a disconnect instead of failing at once.
- Delete the old local `apps/api/homey-dash.db`; it still has the removed `Tiles` table.

## To do

### 2. Dashboards, drafts and publishing

- `Dashboard`: name, rows (default 4), one draft and one published version.
- A version is a JSON document of sections and tiles (kind, size, position, settings).
- Server-side validation: tiles in bounds and not overlapping, size supported by the kind.
- First real EF migration.
- `PUT /api/dashboards/{id}/draft`, `POST /api/dashboards/{id}/publish`, plus list, create, rename and delete.

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
