# Handoff: Sonos multiroom tile

Status as of 2026-11-05. Nothing is committed. Working tree also holds unrelated user edits (editor-page.*, logic-tile.ts, a diff in components.css); leave them alone.

## Goal
Sonos control on the dashboard through Homey (no direct Sonos connection): player controls, volume, and multiroom grouping. Scope chosen: "Player + groups". Favorites/playlists browsing is a later step.

## What is built
- **Tile kind `sonos`** (`libs/tiles/src/lib/sonos/`): `sonos-tile.ts`, `sonos-tiles.ts` (module `SONOS_TILES`), `sonos-tiles.spec.ts` (4 tests). Target type `device`, `multiple: true`, `details: false`, sizes wide/full/large/full-large. Registered in `apps/display` and `apps/management` `app.config.ts`, exported from `libs/tiles/src/index.ts`.
- **Behaviour:** lead room = first playing room, else first. Shows track/artist over album art, prev/play/next (via `speaker_prev`/`speaker_playing`/`speaker_next` capabilities), one volume slider (group volume when 2+ rooms group, else the room's `volume_set`). Large sizes list each room with own volume and a join/leave button. Group membership = equal `sonos_group` capability value.
- **API:** `IHomey` gained `JoinSpeakerGroupAsync`, `LeaveSpeakerGroupAsync`, `SetGroupVolumeAsync` (`apps/api/Homey/IHomey.cs`). `LocalHomey` runs Homey flow actions `cloud_join_household_player` (player arg resolved via autocomplete by the target's device name), `cloud_leave_current_group`, `set_group_volume` (1–100). `FakeHomey` implements them by editing `sonos_group`/`volume_set` and has two fake speakers (living-speaker, kitchen-speaker). Hub methods in `apps/api/Realtime/RealtimeHub.cs`; client methods in `libs/api-client/src/lib/realtime.ts`; `FakeRealtime` in `libs/api-client/src/testing.ts`.
- **Docs/CSS:** MCP tile docs in `apps/api/Mcp/ManagementTools.cs`; styles appended to `libs/design-system/src/components.css` (`.hd-sonos*`).

## Verified
Fake Homey end to end in the display (join moved a room into the group, tile showed "2 rooms"). `dotnet test apps/api-tests` 247 passed; `nx test tiles` passed; lint/build of tiles, display, management passed.

## NOT verified (do first)
1. **Homey flow-card REST paths** in `LocalHomey.FlowCardAction`: `api/manager/flow/flowcardaction/{uri}/{card}/run` and `/autocomplete` (body `{name, query, args}`; run body `{args}`). Written from memory of homey-api; confirm against the real Homey (192.168.1.244) or homey-api source. Card ids look like `homey:device:<id>:cloud_join_household_player`, so uri = `homey:device:<id>`.
2. Join matches the autocomplete result whose `name` equals the target device's Homey name; Sonos room names may differ.
3. Whether `sonos_group` really takes the same value for speakers in one group. Real speakers currently each show their own room name (Office=Kantoor, Slaapkamer, Woonkamer, Kitchen=Keuken).
4. Visual polish: room names truncate on narrow tiles; check Management editor picker and the preview with real speakers. Add an ADR (like ADR-0009) and CONTEXT.md glossary entry (**Sonos tile**) once the design settles.

## Later
Favorites/playlists: Homey cards `cloud_play_sonos_favorite` / `cloud_play_sonos_playlist` take an autocomplete arg. Needs an API endpoint to list them and a picker in a detail view.

## How to run
Use `.claude/launch.json`: `api-fake` (5212) + `display` (4300). Test data used: dashboard with `sonos` tiles `{"target":null,"targets":["living-speaker","kitchen-speaker"]}`, published and assigned to a new display through the API. Build artifacts go under `tmp/claude/`, never `apps/api/bin`.

## Update: smaller elements and a 3×4 size
- New tile size `full-tall` (3×4, label "Full tall"): `libs/layout/src/lib/tile-size.ts`, `TileSize.FullTall` in `apps/api/Dashboards/DashboardModels.cs` and `DashboardValidator.cs`, CSS span rule, MCP docs, design-system docs. Only the Sonos kind offers it so far. The size picker now shows 3 per row with taller icons.
- Sonos elements are smaller (round buttons .34 cell, slider .1 cell); the room list scrolls if rooms don't fit; the speaker icon is hidden on wide/large tiles. Rooms list shows on every size except wide/full.
- Device picker for the Sonos kind only lists devices with `sonos_group` (`TileKind.requiresCapability`).
- Latest design: every size (small to full-tall) shows a compact face (music, play/skip, group volume; small is music + play only). A press opens a modal (`hd-tile-details`) with the group volume and every room; `full-tall` also lists rooms on the tile. Replaced the earlier "only full-large/full-tall" restriction.
- Not yet checked with the real four speakers on a 2×2 tile.
