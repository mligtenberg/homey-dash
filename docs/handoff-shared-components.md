# Handoff: generalise shared components, logic and styling

Status as of 2026-11-08. Work is on branch `refactor/shared-components`, one commit per phase. Nothing is pushed.

## Goal
Duplicated building blocks have crept in feature by feature. This work pulls them into shared helpers, tokens, CSS classes and Angular components without changing behaviour.

Decisions already made:
- Scope: all areas, in phases. Each phase is its own commit and leaves the app working.
- Shared Angular UI goes in `libs/design-system` (tag `type:ui`, prefix `hd`). Management-only domain pieces go in `apps/management/src/app/shared/` (and `accounts/`, `photos/`).
- Visual changes are allowed only where the design-system docs call for them:
  - Lucide icons instead of ↑ ↓ ✕ ← › glyphs.
  - One title scale: page 22px, panel 18px, section 16px.
  - One disabled opacity.

  Anything else must stay pixel-identical.

## Progress
| Phase | State | Commit |
|---|---|---|
| 0. design-system becomes an Angular lib | done | `1bb0f9b` |
| 1. Shared pure helpers | done (see "Skipped" below) | `3d37357` |
| 2. Tokens and CSS | done for Management; display-side CSS cleanup deferred (see below) | see git log |
| 3. design-system Angular primitives | done as far as it paid off (see "Update, second pass") | see git log |
| 4. Management domain components | done as far as it paid off (see "Update, second pass") | see git log |
| 5. Shared tile controls | done as far as it paid off (see "Update, second pass") | see git log |
| 6. Split the big tile files | done for the Plex and Sonos tiles (see "Update, second pass") | see git log |

### Phase 0 (done)
`libs/design-system` is now an Angular lib:
- Its `project.json` has a `test` target using `@angular/build:unit-test`, the same as `libs/tiles`.
- Its eslint and tsconfig files are copied from `libs/tiles`.
- `vitest.config.mts` is removed.

### Phase 1 (done): what now exists
**`libs/api-client`:**

| Helper | File | What it is |
|---|---|---|
| `apiProblem(e, fallback, ...statuses)` | `problems.ts` | The API's own message, else the fallback. Replaces the `problem()` that lived in `immich-albums.ts`. |
| `apiProblems(e)` | `problems.ts` | All validation errors, joined. |
| `fieldErrors(e)` | `problems.ts` | 400 errors mapped by field. |
| `isStatus(e, ...codes)` | `problems.ts` | Status check. |
| `capabilitySignal()` | `displays.ts` | Parses a capability signal id. |
| `FULLY_FUNCTIONS` | `displays.ts` | Fully Kiosk functions with labels. Used by `kiosk-screen.ts` and `display-details-tab.ts`. |
| `stopOnDestroy(...stops)` | `realtime.ts` | Replaces the `const stops = [...]; onDestroy(forEach)` pattern. |

**`libs/design-system/src/lib`:**
- `time.ts`: `clock(ms, active?)`, `minuteClock()`, `timeAgo`.
- `lists.ts`: `moved`, `removedAt`, `changedAt`, `chunk` (with a spec).

**`libs/tiles`:**
- `ruleAnswersOf(rules)` (`logic/rule-answers.ts`). Used by `logic-tile`, `shown-sections` and the display `app.ts`.
- `flasher<T>()` (`core/tile-view.ts`). Used by `TileView` and `device-details`.
- In `core/device-look.ts`: `capText`, `isPlaying`, `nowPlaying`, `albumArtUrl`.
- `COVER_STATES` is now exported once, from `core/device-controls.ts`.
- `plexIdle` moved to `plex/plex-data.ts`, and `plexTime` now reuses `clockTime`.
- `logHue` now reuses `statisticTone`.

**`libs/layout`:** `cells(size)` and `isLandscape(size)`. `RECENT_POSTERS` is gone.

### Skipped on purpose
Each of these would have added code rather than removed it:
- **`PlexAccountApi.untilSignInSettled`.** The Plex panel's sign-in poll shows every intermediate state, so a poll that emits once doesn't fit.
- **One `format.ts` for every formatter.** They already live next to their only users.
- **`elementSize()`.** The four ResizeObserver blocks each do something different.
- **`attempt()` / busy-error runner.** Not done in Phase 1. Reconsider in Phase 4 together with the account panels.
- **Extending `absentFace()` for the mood-list, Sonos and photo tiles.** Each copy is three lines, and the parameters needed would cost more than they save.
- **The statistic windows list.** Folded into Phase 5's `<hd-statistic-pane>` instead.

### Phase 2 (done for Management)
- **New shared classes in `components.css`** (Management section): `.hd-muted`, `.hd-hint`, `.hd-error`, `.hd-small`, `.hd-actions`, `.hd-page__header/__title/__body(--narrow)`, `.hd-panel__title`, `.hd-section-title`, `.hd-account/__head/__item/__info`, `.hd-color-input`, `.hd-btn--sm`, `a.hd-btn { text-decoration: none }`.
- **Components moved onto them:** all 4 account panels, immich-partners, accounts, photo sets, photo set, displays, display page and its tabs, display-screenshot, the editor page (`editor-page.html/.scss`), tile-panel, logic-panel, plex-target-field, photo-set-field, background-field, color-scheme-wheel, photo-selection-form, and the display app's `setup.ts`.
- **Tokens:** removed the unused `--tile-raised` token, and renamed `.hd-tile`'s own `--raised` to `--tile-raised` to match the docs. Defined `--radius-lg: 16px`. Removed the dead `.hd-stage .hd-tile.is-selected` rule.
- **Verified:** the style diff on 14 Management pages shows only `gap` on single-child headers, which has no visible effect.
- **Intended change:** the home page's h1 went from 20px to 22px. That page only shows when no dashboard exists.
- **Deferred, display side:**
  - Plex gold literals → `var(--k-ink)`. This needs a check of every Plex dialog state, because some `.hd-plex-recent__*` classes may sit on tile faces that set their own `--k-ink`.
  - The 21 ellipsis and 11 hidden-scrollbar blocks.
  - Motion and z-index tokens.
  - Collapsing the duplicated dark-theme block in `tokens.css`. This needs `light-dark()`, which old Fully Kiosk WebViews may lack, so it may be better left as it is.

### Phase 3 (partly done)
- **`<hd-reorder-buttons>` and `<hd-remove-button>`** (`libs/design-system/src/lib/reorder-buttons.ts`, with a spec).
  - They replace the ↑ ↓ ✕ text buttons in the dashboards, idle and lock tabs, `tile-panel` and `logic-panel`.
  - The icons are now Lucide, which is an intended visual change.
  - `.hd-btn--icon` keeps them 40×40, the same height as the text buttons.
- **Shared picker shell** in `apps/management/src/app/editor/picker-dialog.ts`:
  - `<hd-picker-dialog>`: trigger, search, nav slot `[pickerNav]`, list, `open()` / `close()`, and scrolls the current item into view.
  - `<hd-picker-row>`.
  - Global `.hd-picker*` CSS in `components.css`.
  - `signal-picker.ts` and `target-picker.ts` now hold only their tree logic.
  - Checked by hand in the browser: open, search, close, and the current item scrolled into view.
- **`<hd-back-link>`** (`libs/design-system/src/lib/back-link.ts`, with a spec): the Lucide-arrow back link on the display and photo-set pages. It replaces the "←" glyph, an intended visual change. The pages keep their own font size and weight on the host.
- **Still to do:** `hdIcon`, `<hd-page-header>` (the title/header frame; back links are done), `<hd-empty-state>`, `<hd-confirm-inline>`, `hdRenameInput`, `hdAutofocus`, `<hd-error-line>`.

### Phase 4 (partly done)
- **`apps/management/src/app/address-key-accounts.ts`:**
  - `addressKeyAccounts(api, noun)` holds the state and save/remove logic both panels had copied. It has a spec.
  - `<hd-address-key-form>` is the shared name/address/API key form.
  - `homey-account-panel.ts` and `immich-account-panel.ts` now keep only their own rows: Homey's status pills and Immich's partners.
- **Still to do** from the list below:
  - `<hd-account-panel>` frame (the Plex and AirPlay panels could use it too)
  - `tree-utils.ts`
  - `<hd-album-select>` and `ImmichAccountsStore`
  - `<hd-account-select>`
  - `<hd-rule-row>`
  - `rxResource` for route loading
  - the immich-partners race
  - `fittedCell`

### Phase 5 (started)
- `libs/tiles/src/lib/core/statistic-readings.ts` (`<hd-statistic-readings>`): the readout, chart and figures that `statistic-tile.ts` and `statistic-history.ts` both had.
- Everything else in the Phase 5 list below is still to do.

### Bundle size
The initial bundles grew a little:
- Management: about +10 kB (915 → 926 kB).
- Display: about +2.4 kB (815 → 817 kB).

The cause is that shared picker, account and page CSS now lives in the global `components.css`, which both apps load up front. Before, it sat in each component's lazily loaded chunk. Both budgets were already exceeded before this work.

If this matters, there are two options:
- Move the Management-only sections of `components.css` (picker, account, page) into a stylesheet that only `apps/management` loads.
- Put them back as component `styles` on the shared components: `PickerDialog`, `AddressKeyForm`.

## Update, second pass
Lint, tests and builds were green for design-system, tiles, layout, api-client, management and display after every commit. **None of it was checked in a browser**: the dev-server ports and the Nx task lock were held by another process, so the style-diff and the display baseline were not run. Do that first (see "How to verify"). The intended visual changes are the Lucide back-arrow and the segmented/transport buttons keeping their classes, so the style diff should show only the arrow.

**Added**
- `hd-back-link` (design-system).
- Management: `hd-account-panel` (frame, status slot, error line; Homey, Immich, Plex, AirPlay use it), `editor/tree-utils.ts` (`byName`, `searchWords`, `matchesWords`, `findNode`, used by `signal-tree.ts` and `target-tree.ts`), `hd-album-select` (photo-sets page and photo-set field), `hd-account-select` (tile panel, Plex target field, lock tab).
- Fixed the `immich-partners` race: the effect now cancels its previous request. `preview-page` loads with `rxResource`.
- Tiles (`libs/tiles/src/lib/core/`): `hd-segmented` (device details, statistic tile and history, Plex, Sonos), `WINDOW_TABS` (statistic windows), `pager()` and `hd-page-dots` (dashboard view and mood list), `brokenImages()` (device apps and details, Plex now playing, Sonos), `SliderDrag` (capability driver and Sonos volume), `hd-transport` (Sonos, device details, Plex), `hd-setting-select` (device, statistic, photo and Sonos settings editors).
- Phase 6: `recently-added-tile.ts` went from 1149 to 870 lines. The profile picker is `hd-plex-profile-picker`, the local music player is `PlexLocalPlayer`, and the Apple TV controls are `hd-plex-airplay-controls`. `reason()` moved to `plex/hub-reason.ts`. `sonos-tile.ts` went from 712 to 460 lines: `SonosMusic` is in `sonos-music.ts`, and the settings editor is in `sonos-tile-settings.ts`.

**Skipped on purpose** (each would have added code, or changed pixels, rather than removed duplication)
- `hd-error-line`: `.hd-error` already does it.
- `hd-empty-state`: the nine empty states differ in content and markup.
- `hd-confirm-inline`, `hdRenameInput`, `hdAutofocus`, `hdIcon`: not started. The inline Remove/Cancel copies differ per panel, and the native `confirm()` in `editor-page.ts` is still there.
- `hd-rule-row`: the only duplicate is two rows inside `logic-panel`.
- `ImmichAccountsStore`: `loadAlbums()` already covers it.
- `fittedCell`: `fittedCellSize` in `libs/layout` already exists and both apps use it.
- `rxResource` in `editor-page.ts`: its load effect also flushes the old draft on cleanup.
- `hd-device-segments` stays as it is: it has no group label to give `hd-segmented`.
- `hd-tile-titles`, `hd-reading`, `hd-note`, `hd-art`, `hd-playbar`, `hd-level-row`, `hdHold`, `hd-statistic-pane`: not started. The tile titles sit in CSS selectors such as `.hd-row:has(+ …)`, so wrapping them would change the layout.
- Phase 6, third pass: `PlexTileView` (`plex/plex-tile-view.ts`) holds `plex`, `realtime`, `overview` and `accountId` for the recently-added, library and now-playing tiles. It replaced eleven copies of `overview()?.accountId ?? 0`.
- Phase 6, skipped on purpose: `keyedLoader` (`pages` and `under` load differently, so a helper would add code), and `<hd-plex-item-detail>` / `<hd-plex-card>` (the detail view needs about fifteen inputs and outputs from the tile, and the cards differ per use, so it would add code and change the DOM).
- Browser check done in the preview (api-fake, management, display): Sonos tile, details, favorites and slider drag; Plex recently-added tile, profile picker, item view and AirPlay picker; account panels; photo-set album select; display lock tab and back link. No console errors. The style-diff against the baseline was not run.

**Formatting note.** Early in this pass, `prettier --write` reflowed whole files that were never prettier-formatted, so four commits carry big noisy diffs. A later commit ("Restore the original formatting…") puts those files back. Only run prettier on files you created.

## Next: type tokens (agreed, not started)
The display's text sizes are about 25 different `calc(var(--cell) * x)` multiples (`.085`, `.09`, `.095`, `.1` and so on), and Management uses fixed pixels (12, 13, 16, 18, 22, 28). Weights are 500, 600, 700 and 800 as literals. `tokens.css` only defines `--font-sans`. Plan:
1. **Weights:** `--weight-regular/medium/bold/heavy` (500, 600, 700, 800). No pixel change, so do it first.
2. **Management sizes:** `--text-small/body/section/panel/page` as fixed pixels (the sizes Phase 2 planned).
3. **Display scale:** `--tile-text-xs/s/m/l/xl/xxl` as `--cell` multiples, with `--value-xl/l/m` for the big values. First write a table mapping every current multiple to its nearest step and get it approved, because merging near-duplicates changes some sizes slightly.
4. Replace the literals in the CSS and component `styles:`, then run the style diff.

## Next steps (original plan, partly done; see the update above)

### Phase 2: tokens and CSS (`libs/design-system/src/tokens.css`, `components.css`)
1. **`tokens.css`:**
   - Collapse the duplicated dark block (lines 53-93 = 97-137).
   - Make `--tile-raised` use `var(--emboss-shade)`, and have `.hd-tile` use it.
   - Define `--radius-lg` (it is used at components.css 1097 and 1120 but undefined; it falls back to 16px, so define it as 16px).
   - Add these tokens:

     | Group | Tokens |
     |---|---|
     | Type | `--text-page-title` (800 22px/1.2), `--text-panel-title` (800 18px), `--text-section-title` (800 16px), `--text-small` (13px) |
     | Motion | `--duration-*`, `--ease-*` |
     | Z-index | `--z-*` |
     | States | `--opacity-disabled`, `--touch-min` (44px) |
     | Focus | `--focus-width`, `--focus-offset` |
     | Surfaces | `--scrim`, `--brand-tint`, `--brand-tint-strong` |
     | Over media | `--on-media` and the other media colours |

2. **Utilities in `components.css`:**
   - `.hd-truncate`, which replaces the 21 ellipsis blocks.
   - `.hd-no-scrollbar`, which replaces 11 blocks.
   - `.hd-sr-only`.
   - `.hd-muted`, `.hd-hint`, `.hd-error`, `.hd-error--field`.
   - `.hd-cluster`, the `.actions` flex row.
   - `.hd-fade-enter` / `.hd-fade-leave`, which replace `hd-logic-in/out` in `logic-tile.ts`, `slideshow-out` in the display `app.ts` and `hd-photo-in`.
3. **Management classes:**
   - `.hd-page`, `__header`, `__title`, `__back`, `__body`. Six pages copy their header/body CSS: `accounts-page`, `photo-sets-page`, `photo-set-page`, `displays-page`, `display-page` and `editor-page.scss`.
   - `.hd-tabs` / `.hd-tab`, from `display-page.ts`.
   - `.hd-row` / `__info`, the `.item` rows in the four account panels and `immich-partners`.
   - `.hd-dialog`, the picker dialog plus its backdrop.
   - `.hd-empty`, `.hd-color-input`, `.hd-panel--link`, `.hd-list-button`.
   - `a.hd-btn { text-decoration: none }`.
4. **Strip the matching inline `styles:` rules** from the components and switch their templates to the new classes. The biggest offenders are listed in `.error`/`.muted`/`.hint` order in the inventory below.
5. **Plex colours:** in `components.css`, swap `#e5a00d` / `#1f2326` for `var(--k-ink)` / `var(--on-kind)` inside `.hd-plex*`. Line 973 already sets those custom properties there.
6. **Delete dead CSS:**
   - `.hd-chip` (172-174).
   - `.hd-stage .hd-tile.is-selected` (724). `editor-page.scss:43` already does this on `hd-tile-host`.
   - The duplicate spinner (651-655 vs 1266-1271).
7. **Update the docs:** `docs/design-system/README.md`, `components/FormField.md` and `components/Button.md`.

### Phase 3: design-system Angular primitives
All are standalone, use signal inputs and have a spec.
- `svg[hdIcon]` (size `sm|md|lg|cell`, plus `duotone`).
- `<hd-page-header>`.
- `<hd-empty-state>`.
- `<hd-reorder-buttons>` (Lucide ArrowUp, ArrowDown and X). Five sites: the display idle, lock and dashboards tabs, `tile-panel` and `logic-panel`.
- `<hd-confirm-inline>`. Replaces six inline Remove/Cancel copies and the native `confirm()` in `editor-page.ts`.
- `hdRenameInput`.
- `hdAutofocus`.
- `<hd-error-line>`.
- `<hd-picker-dialog>` and `<hd-picker-row>`, for `signal-picker.ts` and `target-picker.ts`.

### Phase 4: Management domain components
Write specs for the panels and pickers **first**; they have none today.
- **`<hd-account-panel>`:** the frame, status pill and error line. Used by the Homey, Immich, Plex and AirPlay panels.
- **`<hd-address-key-form>`** and an `addressKeyAccounts()` controller. The Homey and Immich panels are about 90% identical.
- **`tree-utils.ts`:** `byName`, `findNode`, `matchesWords`, shared by `signal-tree.ts` and `target-tree.ts`.
- **`<hd-album-select>`** (3 sites) and an `ImmichAccountsStore`.
- **`<hd-account-select>`:** `tile-panel`, `plex-target-field`, `display-lock-tab`.
- **`<hd-rule-row>`.**
- **`rxResource`** for route loading in `editor-page.ts` and `preview-page.ts`.
- **Fix a race in `immich-partners.ts`:** the effect at about line 96 doesn't cancel the previous request.
- **`fittedCell(rows)`** in `libs/layout`, used by the display `app.ts` and `preview-page.ts`.

### Phase 5: shared tile controls (`libs/tiles/src/lib/core/`)
- `SliderDrag`. Sonos copies `CapabilityDriver` at `sonos-tile.ts` around 587 and 650-682.
- `<hd-transport>` (5 sites) and `<hd-playbar>`.
- `<hd-art>`. Four broken-image copies; it also gives the Plex posters the fallback they lack.
- `<hd-segmented>` (5 sites).
- `<hd-tile-titles>` (9 fallback faces).
- `<hd-reading>`.
- `<hd-note>`.
- `hdPager` and `<hd-page-dots>`: `dashboard-view` and `mood-list-tile`.
- `<hd-setting-select>`.
- `<hd-level-row>`.
- `hdHold`.
- `<hd-statistic-pane>`, which merges `statistic-tile.ts` 106-134/258-278 with `statistic-history.ts` 85-150.

### Phase 6: split the big tile files
- **`plex/recently-added-tile.ts`** (1152 lines) splits into:
  - a `PlexLocalPlayer` service
  - `<hd-plex-airplay-controls>`
  - `<hd-plex-profile-picker>`
  - `<hd-plex-item-detail>` and `<hd-plex-card>`
  - `keyedLoader`
  - an `accountId` computed
  - a `PlexTileView` base class, shared with `now-playing-tile`
- **`sonos/sonos-tile.ts`:** move `SonosMusic` and the settings editor into their own files, built on the Phase 5 controls.

## How to verify
**Tests:**
```bash
NX_DAEMON=false NX_WORKSPACE_DATA_DIRECTORY=tmp/claude/nx npx nx run-many -t lint test build -p design-system tiles layout api-client management display
```
- The baseline is green. The only lint output is pre-existing warnings.
- The two "bundle initial exceeded maximum budget" warnings were already there before this work.

**Visual checks:**
1. Run `api-fake` (5212), `management` (4301) and `display` (4300) from `.claude/launch.json`. Build artifacts go under `tmp/claude`, never `apps/api/bin`.
2. Style-diff tool: `tmp/claude/style-snapshot.js`. It is local and gitignored.
   - Paste its contents into the browser console (or `javascript_tool`) on `http://localhost:4301/admin/...`.
   - `await __saveAll()` stores the computed styles of every element on 14 Management pages in IndexedDB.
   - `await __diffAll()` lists what changed per page.
   - Baselines **were saved before any Phase 2 change**. Re-running `__diffAll()` straight away showed only one live Plex progress width, which is noise.
   - Only the intended visual changes listed under "Goal" should show up.
3. The display app (4300) has no baseline yet. Save one there before you change tile CSS.

## Duplication inventory (where the copies are)
- **`.error`**, 13 copies: airplay 119, homey 168, plex 172, immich 156, display-page 48, displays-page 48, display-screenshot 34, background-field 121, photo-set-field 63, photo-selection-form 131, photo-set-page 215, photo-sets-page 175, display `setup.ts` 60.
- **`.muted`**, 12 copies: photo-set-page, airplay, photo-sets-page, immich-partners, homey, plex, shell, immich, display-screenshot, display-details-tab, tile-panel, `setup.ts`.
- **`.hint`**, 11 copies: immich-partners, homey, photo-selection-form, the lock, dashboards and idle tabs, immich, `editor-page.scss` 78, background-field, logic-panel, plex-target-field.
- **`.actions`**, 7 copies: photo-set-page, airplay, photo-sets-page, immich-partners, homey, plex, immich.
- **The two pickers' styles:** `signal-picker.ts` 118-167 and `target-picker.ts` 89-134 are about 85% identical.
