---
name: HomeyDash
description: Soft, tactile smart-home displays coloured by what each tile controls, managed from a quiet architect's drawing of the home.
colors:
  ground: "#e4e6ee"
  tile-surface: "#f1f2f7"
  ink: "#22252f"
  ink-muted: "#5f6477"
  line: "#d4d7e2"
  emboss-shade: "#c5c8d6"
  chrome: "#f7f8fb"
  panel: "#ffffff"
  brand: "#4364df"
  on-brand: "#ffffff"
  mgmt-sheet: "#eef1f5"
  mgmt-sidebar: "#f8f9fb"
  mgmt-line: "#d5dbe4"
  mgmt-line-strong: "#b9c2cf"
  ink-soft: "#3d4757"
  mgmt-brand: "#3a63c9"
  sec-overview: "#3a63c9"
  sec-dashboards: "#6b4fc8"
  sec-displays: "#0b7d84"
  sec-photos: "#2a8350"
  sec-accounts: "#a3367f"
  ok: "#1c8742"
  warn: "#975800"
  danger: "#c8364a"
  lock-warn: "#ffd166"
  lock-danger: "#ff9b85"
  kind-light-ink: "#8c5700"
  kind-light-fill: "#f5cb70"
  kind-heat-ink: "#aa3700"
  kind-heat-fill: "#ffb695"
  kind-flow-ink: "#007e5e"
  kind-flow-fill: "#6febcc"
  kind-mood-ink: "#7347af"
  kind-mood-fill: "#ddbfff"
  kind-security-ink: "#007b2a"
  kind-security-fill: "#96e7a7"
  kind-energy-ink: "#0064b9"
  kind-energy-fill: "#93d7ff"
  kind-cover-ink: "#00769b"
  kind-cover-fill: "#63e5ff"
  kind-appliance-ink: "#007b87"
  kind-appliance-fill: "#5ce9f0"
  kind-climate-ink: "#006fab"
  kind-climate-fill: "#74e0ff"
  kind-neutral-ink: "#355bbd"
  kind-neutral-fill: "#aad0ff"
typography:
  tile-value-xl:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "0.5 × cell"
    fontWeight: 700
  body:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
  plan-label:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.1em"
  page-title:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  panel-title:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  section-title:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  item-title:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  caption:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  screen-title:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.15
  touch-input:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
rounded:
  key: "2px"
  tag: "4px"
  mgmt-control: "6px"
  mgmt-panel: "8px"
  control: "8px"
  panel: "10px"
  lg: "16px"
  pill: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
components:
  button:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.mgmt-control}"
    padding: "9px 14px"
  button-primary:
    backgroundColor: "{colors.mgmt-brand}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.mgmt-control}"
    padding: "9px 14px"
  button-small:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.mgmt-control}"
    padding: "5px 10px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.mgmt-control}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.mgmt-panel}"
  page-header:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.page-title}"
    padding: "16px 24px"
  plan-label:
    textColor: "{colors.ink-muted}"
    typography: "{typography.plan-label}"
  nav-place:
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.mgmt-control}"
    padding: "6px 8px"
  nav-place-current:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.mgmt-control}"
    padding: "6px 8px"
  row-link:
    textColor: "{colors.ink}"
    padding: "12px 16px"
  status-tag:
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "3px 8px"
  tile:
    backgroundColor: "{colors.tile-surface}"
    textColor: "{colors.ink}"
  tape-item:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
    height: "44px"
---

# Design System: HomeyDash

## Overview

**Creative North Star: "The Tactile Wall"**

HomeyDash has two faces. A display is a wall of soft, button-like tiles, read across a room and touched for a second. Management is **"a quiet architect's drawing of the home"**: a pale blue-grey sheet with white panels drawn in hairlines, small letter-spaced plan labels heading each block, and one hue per part of the home on its marks, so you can tell where you are at a glance. Colour on a display belongs to the thing being controlled: every tile kind owns one hue, and nothing else on a display is coloured. Colour in Management belongs to the place you are in; actions keep one ink-blue.

Displays are calm. Nothing moves on its own except a photo fading to the next and a Plex progress bar. When left alone a display turns into a photo frame with a quiet layer of white lock-screen widgets over the picture.

Management is visited every few weeks by someone who does not remember where things live, so its frame never changes: the same five places, in the same order and colours, with what is in each. Displays are drawn as framed screen outlines; the editor's stage still shows the real tiles exactly as a display does.

The system follows the device's light or dark preference, and never hard-codes one theme.

**Key Characteristics:**
- Colour means a kind of thing; status colour is only ever status.
- Tiles feel like buttons: one soft lift, controls inside sit flat, a press shrinks the tile.
- Everything on a display scales from one `--cell`, the screen height divided by the row count (4 by default).
- Management is drawn, not lifted: hairlines, plan labels, a place hue for where you are, one ink-blue for what you can do.
- Plain English, sentence case, no emoji or exclamation marks.

## Colors

A cool periwinkle-grey neutral ground carrying ten kind hues, each in a readable ink and a saturated fill. The values listed are the light theme; the dark theme has its own counterpart for every token. Management loads its own layer (`apps/management/src/styles.scss`) over the shared tokens: a bluer sheet, its own hairlines, an ink-blue accent and five place hues.

### Primary
- **Drawing Ink-Blue** (`mgmt-brand` #3a63c9, dark #8eabff): the one action colour in Management: primary button, text links ("See all", "Set up Homey"), selected items, picker selection, checked controls, caret, text selection and every focus ring. Text on it is `on-brand` (#ffffff, dark #0c142d). Management sets it as `--brand`; the shared library's `brand` (#4364df, dark #85a6ff) is the default for any other surface that loads the library. Never on a display tile.

### Secondary: kind hues
Each kind has an `-ink` (icon, chart line, slider fill, chip; 4.5:1 on `tile-surface`) and a `-fill` (background of an active tile; text on it is always `ink`).
- **Lamp Amber** (`#8c5700` / `#f5cb70`): lights, dimmers.
- **Heater Orange** (`#aa3700` / `#ffb695`): heating, thermostats.
- **Flow Teal** (`#007e5e` / `#6febcc`): flow tiles.
- **Mood Violet** (`#7347af` / `#ddbfff`): mood tiles.
- **Lock Green** (`#007b2a` / `#96e7a7`): locks, doors, motion.
- **Energy Blue** (`#0064b9` / `#93d7ff`): power and energy.
- **Curtain Cyan** (`#00769b` / `#63e5ff`): curtains, blinds.
- **Appliance Teal-Cyan** (`#007b87` / `#5ce9f0`): TV, washing machine, speakers.
- **Climate Sky** (`#006fab` / `#74e0ff`): temperature and humidity sensors.
- **Neutral Periwinkle** (`#355bbd` / `#aad0ff`): anything without its own hue.

In Management the kind hues appear only where a tile kind is meant: the editor stage and the Add a tile chooser.

### Tertiary: place hues (Management)
One hue per part of the home, used as ink for marks and text and as a wash (`--wash`, 11% light, 16% dark) behind them. A page sets `--sec` for its place; everything that belongs to that place reads it.
- **Overview** (`sec-overview` #3a63c9, dark #8eabff): the home place; the same value as the action ink-blue.
- **Dashboards Violet** (`sec-dashboards` #6b4fc8, dark #b4a1ff): dashboards, and a dashboard's name wherever it appears (on a display sketch, in Unpublished changes).
- **Displays Teal** (`sec-displays` #0b7d84, dark #4ec8cf): displays; the glass of a drawn screen.
- **Photo Sets Green** (`sec-photos` #2a8350, dark #6dcc94): photo sets.
- **Accounts Plum** (`sec-accounts` #a3367f, dark #f08fd2): accounts. The direction asked for amber; the build moved it to plum so it can never be mistaken for `warn`.

### Neutral
- **Ground Mist** (`#e4e6ee`): display background and recessed wells.
- **Tile Surface** (`#f1f2f7`): a resting tile. `tile-glass` is the same, see-through, over a blur, for a tile over a background image.
- **Ink** (`#22252f`) and **Ink Muted** (`#5f6477`): primary and secondary text.
- **Ink Soft** (`#3d4757`, dark `#c3c8d4`): Management's second voice, between ink and muted: nav labels, lead lines, field labels, crumb links.
- **Hairline** (`#d4d7e2`): the library's border; on displays, the outline of a missing tile.
- **Chrome** (`#f7f8fb`) and **Panel** (`#ffffff`, Management dark `#1e222a`): the library's page and panel surfaces. Panel is also every Management panel, page header, field and button.
- **Drawing Sheet** (`mgmt-sheet` #eef1f5, dark #14171d): the Management page ground, a pale blue-grey sheet.
- **Sidebar Paper** (`mgmt-sidebar` #f8f9fb, dark #181b22): the sidebar, the group rail of a picker, the ⌘K key.
- **Drawing Line** (`mgmt-line` #d5dbe4, dark #2e3440): Management hairlines: panel borders, dividers between rows, the line under a block head, the rule beside a place's items.
- **Strong Line** (`mgmt-line-strong` #b9c2cf, dark #444c5a): edges you act on: buttons, fields, the Go to trigger, pickers; crumb slashes; the dashed frame of an empty display. Hover deepens it to `ink-muted`.
- **Emboss Shade / Light** (`#c5c8d6` / `#ffffff`): the two ends of a tile's lift.

### Status
- **OK** (`#1c8742`), **Warn** (`#975800`), **Danger** (`#c8364a`): status only, always with a word ("Connected", "Connection lost").
- **Lock Warn / Lock Danger** (`#ffd166` / `#ff9b85`): status on the lock screen. The same in every theme, because the lock screen always lies over a photo.

### Named Rules
**The Kind Hue Rule.** A resting tile carries a light tint of its kind (22% fill over the surface); an active tile fills with it. Inactive tiles stay on `tile-surface` with a tinted icon, so a dashboard is still colourful when everything is off. The share is `--rest-tint`: 22% in light, 36% in dark, where the fills are deep and 22% left heat, security, climate and cover tiles the same grey-blue. Poster and cover art dims to 70% brightness in dark (`--art-dim`), so it is not the brightest thing on a night wall.

**The Status Is Never Decoration Rule.** `ok`, `warn` and `danger` appear only with a word; colour alone never carries state.

**The Brand Stays In Management Rule.** `brand` never appears on a display tile.

**The Where You Are Rule.** A place hue says where you are: the mark beside a place and a page title, the legend key beside a row, the current item in the sidebar, the hover wash of a row and the selected hit in Go to. It never fills a button, colours a link, or draws a focus ring.

**The One Action Colour Rule.** Everything you can do in Management is `mgmt-brand`: primary buttons, links, selection, focus. A second accent for actions is never added.

**The Distinct From Warn Rule.** No place hue may read as a status colour. Accounts is plum, not amber, because `warn` is amber; a new place gets a hue clear of `ok`, `warn` and `danger`.

## Typography

**Font:** Rubik (variable, from `@fontsource-variable/rubik`) with system-ui fallback, for everything.

**Character:** Round, friendly and sturdy, at heavy weights for values and names so they read across a room. Management sets it lighter (600 headings) so the drawing stays quiet.

### Hierarchy
- **Tile value XL** (700, 0.5 × cell): the one hero reading of a Large tile. `value-l` (0.42) and `value-m` (0.24) serve Statistic and Wide tiles. Display sizes are always fractions of `--cell`.
- **Tile name, detail, badge**: fractions of `--cell`; detail lines are short state phrases joined with a middle dot (`On · 80%`).
- **Unit** (600, 0.45em of its value, `ink-muted`): `20.5°C`, `1.84 kW`.
- **Page title** (600, 24px, -0.01em): the Management `h1`, beside its place's mark. Panel title 17/600, section title 15/600; no other heading sizes.
- **Body** (500, 14px, 1.45): Management text; lead lines in `ink-soft`. **Label** (600, 12px): field labels (in `ink-soft`) and status tags. **Caption** (13px): purpose lines, crumbs, row sub-lines, counts.
- **Plan label** (600, 11px, 0.1em, uppercase, `ink-muted`): the heading of a block, as on a drawing ("Needs attention", "Displays", a chooser group). The only uppercase text in Management.
- **Screen title** (800, 28px, `--text-screen-title`): the one heading on a full-screen state (waiting, Setup). **Touch input** (16px, `--text-touch`): inputs and buttons on Setup and screen settings, never below 16px so iOS does not zoom. Caption 13px (hints, sub lines), item title 15px.
- **Small-text roles** (`--t-caption` .085, `--t-detail` .1, `--t-name` .12, `--t-sub` .145, `--t-title` .17, about 1.2 apart): each is `max(var(--t-x-min), calc(var(--cell) * var(--t-x)))` with floors of 11, 11, 11.5, 14 and 16px (tuned on the 916×610 hardware at 6 rows, where a 12px name breaks "Thermostat" mid-word), so the order caption < detail < name < sub < title holds on a short screen. Detail lines are weight 600, names 700. Every small display text uses one of these five; hero values stay on `--value-scale-*`.
- **Floor**: `--text-floor` (11px) is the caption floor; no display text goes below it.
- **Lock screen**: scales with the viewport height: clock time 13 × 1vh at weight 300, readings 4.6 × 1vh at 500, labels 1.9 × 1vh.

### Named Rules
**The Tabular Figures Rule.** Every number uses tabular figures.

**The Cell Scales Type Rule.** Never use fixed pixels for type on a display, except the 44px minimum on touch controls, the screen title and touch input roles, and the `--text-floor`.

**The Line Break Rule.** Headings and tile names use `text-wrap: balance`; lines of prose (lead, hint, muted) use `text-wrap: pretty`.

**The Plan Label Rule.** A plan label is the heading of its block, never a line set above another heading.

## Layout

A display shows a dashboard as sections side by side. A section is 3 cells wide and `rows` tall. Cell size is screen height ÷ rows. Only whole sections that fit the width are shown, centred, as one page; further sections are further pages, swiped between, with a dot per page. On a display with several dashboards, the first 68px on the left is a gutter for the dashboard tape: sections are fitted to and centred in what is left, and a page swiping across the gutter fades out under the tape. A cell only shrinks (by up to 10%) to fit another section when the dashboard has one to show. Tiles snap to a fixed set of sizes (small 1×1, wide 2×1, full 3×1, large 2×2, full-large 3×2, full-tall 3×4), never overlap, never reflow, and dashboards never scroll vertically.

All display measures are ratios times `--cell`: gap 0.08, section gap 0.176, padding 0.11, radius 0.2, icon 0.27, control 0.42.

Management uses the `space-1…6` scale (4–24px). A sticky 252px sidebar on `mgmt-sidebar` sits beside the page; below 860px it becomes a top bar with the five places in one scrolling row (items and counts hidden). Every page opens with the same header on `panel`: crumbs, the place's mark, title, purpose line, actions on the right (at least 64px, padding 16 × 24). Page bodies are padded 24px with a 16px gap, at most 900px (640px narrow). The Overview is two columns, the drawn displays left and a 300–400px column right (Needs attention, Unpublished changes, What do you want to do?), at most 1360px wide; below 1080px it is one column with the right column first. Below 560px padding drops to 16px (header 12 × 16). In the editor, tiles render at a fixed `--cell` of 92px.

## Elevation & Depth

Two faces. **Displays** are lifted: every resting tile has one soft shadow (`tile-raised`) and nothing inside a tile has a shadow. **Management** is drawn, not lifted: panels get a 1px hairline instead of a shadow, and the current sidebar place is a white panel with a 1px inset hairline. The only Management shadows are under modal dialogs (Go to and the pickers), over a dimmed backdrop.

### Shadow Vocabulary
- **Tile raised** (`0 1px 2px emboss-shade@60%, 0 .05·cell .14·cell -.04·cell emboss-shade`): every resting tile.
- **Glass tile** (over a background image): the tile lift plus an inset 1px bright rim along the top (`--glass-rim`), an inset hairline all round (`--glass-edge`) and a 135° sheen (`--glass-sheen`) over an 8px blur: a thick pane, not frosting. Fainter in dark.
- **Detail sheet** (`0 .1·cell .4·cell emboss-shade`) over a blurred `emboss-shade` backdrop: a tile's open details.
- **Tape pill** (`0 1px 3px emboss-shade@60%`) with a 12px backdrop blur: the dashboard tape only.
- **Lock screen text** (`0 1px 2px / 0 0 14px / 0 0 36px` black at 55 / 45 / 35%): white type on any photo; each spot also darkens only its own corner.
- **Go to dialog** (`0 24px 60px -16px` black at 40%) and **Picker** (`0 18px 50px -12px` black at 35%, `mgmt-line-strong` border), each over a `#1d2430` backdrop at 38%: Management's modal dialogs, and nothing else in Management.

### Named Rules
**The Press Rule.** A pressed tile scales to 0.96 and darkens slightly. Every pressable surface also shows a ripple from the point of the press.

**The Tinted Not Raised Rule.** Controls (slider track, segmented control, round buttons) are the kind ink at low opacity, never raised. The tile's quick action is the one solid control.

**The Drawn Not Lifted Rule.** In Management, depth is a hairline. A shadow means a modal dialog is open over the page.

## Shapes

Generous and friendly. Tiles round at 0.2 × cell. Management is drawn tighter: 6px controls and marks (36px header marks 8px), 8px panels, rows and screen frames, 4px status tags and 2px legend keys; pills (999px) stay on displays for the dashboard tape. Icons are Lucide, drawn duotone: stroke 2 in `currentColor`, closed shapes filled at 22%. No emoji, no filled glyphs.

## Components

### Tile
- **Shape:** 0.2 × cell radius, `tile-raised`, padding 0.11 × cell.
- **States:** Hue is the tile's type and never changes with state; state is the intensity of that hue (rest tint, active fill) plus neutral elements on the tile: the corner button is white when on and grey when off. A lock's state colour (blue locked, yellow unlocked) goes on its icon chip, not the tile. Full model in `docs/design-system/State.md`. Active fills with `kind-*-fill`. Unavailable drops to 60% opacity with a warn "Unavailable" badge. Missing becomes a transparent outline in `line` with a danger icon and "Not found in Homey". Connection lost desaturates the dashboard and stops taps.
- **Focus:** a solid 3px ring in the kind ink, offset 3px.

### Buttons
- **Default:** `panel` fill, 1px `mgmt-line-strong` border, 6px radius, 14px/600, padding 9 × 14. Hover deepens the border to `ink-muted`. Press scales to 0.97. Disabled is 45% opacity. **Small:** 13px, padding 5 × 10.
- **Primary:** `mgmt-brand` fill, `on-brand` text, no border; hover mixes in 12% `ink`. **Danger:** text only, in `danger`, underlined on hover.
- **Focus:** 3px `mgmt-brand` ring, offset 2px.

### Inputs / Fields
- `panel` fill, 1px `mgmt-line-strong` border (hover `ink-muted`), 6px radius, 14px/500, placeholder in `ink-muted`. Label above: 12px/600 in `ink-soft`. Errors and hints are 13px. Focus is the 3px `mgmt-brand` ring.

### Status pill
- 12px, text in a status colour over the same colour at 14%; an optional leading dot. Always with a word. In Management it is a squared tag: 600 weight, 4px radius, padding 3 × 8.

### Navigation (Management sidebar)
- The brand (house drawn in 1.6px strokes, 17px/600), the Go to trigger, then the five places in a fixed order: Overview, Dashboards, Displays, Photo sets, Accounts. Each is a 28px mark (icon in its place hue over its wash), the label in `ink-soft` 500 and a count in 13px `ink-muted` tabular figures.
- **Hover:** the place hue at 7%. **Current:** a `panel` block with a 1px inset `mgmt-line`, `ink` 600, and the mark filled solid in the place hue with the icon in `panel`.
- The current place opens to list its items (dashboards, displays, photo sets) indented behind a 1px `mgmt-line` rule: 13px `ink-soft`; the current item gets 12% of the place hue and 600 weight. A dashboard with unpublished changes carries an "Unpublished" `warn` tag.
- **Focus:** 3px `mgmt-brand` ring, offset 1px.

### Page header
- On `panel`, under the crumbs: the 36px mark of its place, the 24px title (with any status beside it), one purpose line in 13px `ink-muted` (at most 72ch, from the place's purpose when the page has none), actions on the right. Crumbs are 13px links in `ink-soft` separated by `/` in `mgmt-line-strong`; hover turns them the place hue, underlined.

### Plan blocks and row links
- A panel whose head is a plan label (optionally a count beside it, `warn` when it counts problems) over a 1px `mgmt-line` rule. Rows inside are whole links divided by hairlines: padding 12 × 16, title 600, sub-line 13px `ink-muted`, a legend key or mark on the left and an arrow on the right. Hover washes the row with 6% of its place hue and nudges the arrow 2px in that hue. Focus is the inset 3px `mgmt-brand` ring. Text links in a block head ("See all") are 13px/600 `mgmt-brand`.
- **Legend key:** a 10px square, 2px radius, in a place hue, beside the name of what belongs to that place. On Needs attention the marks take `warn`, next to words that say what is wrong.

### Display sketch
- A display drawn as a framed screen: a 16:10 frame in 1.5px `ink-soft`, 8px radius, on `panel`, with a 6px bezel around glass in a 9% `sec-displays` wash inside a 1px `mgmt-line`, 3px radius. On the glass: the dashboard it shows in `sec-dashboards` 600, and "+n more". Below: the display's name (600) and its state as a dot plus words (`ok` or `warn`). A display showing nothing is dashed in `mgmt-line-strong` with muted text. Hovering its link turns the frame `sec-displays` and lifts it 2px.

### Go to
- A full-width trigger in the sidebar ("Go to…", `mgmt-line-strong` border, `panel`, a ⌘K key on `mgmt-sidebar`) opens a 620px dialog 12vh from the top, sliding in 6px over .18s. A 16px search over results grouped under plan labels; each hit is a 6px-radius row whose selection is 10% of its place hue, with an enter arrow in that hue. Searches places, items and tasks phrased as questions.

### Add a tile chooser
- A searchable list of tile kinds grouped Homey, Media and Information under plan labels. Each kind is a row with a 32px icon square in its kind fill at 45% and the icon in its kind ink, a 600 name and a 12px `ink-muted` line on what it does. Hover washes the row with 22% of the kind fill and a 25% kind-ink border; focus is the `mgmt-brand` ring.

### Pickers
- A modal sheet with the search on top and groups on a `mgmt-sidebar` rail on the left; the current group is `ink` 700 over 14% `mgmt-brand`.

### Editor stage
- Unchanged by the Management world: real tiles at a fixed 92px `--cell`, with their kind hues, lift and press, exactly as on a display.

### Dashboard tape
- A column of pill buttons floating over a display's left edge when it offers more than one dashboard; at least 44px tall. Starts collapsed to one toggle; the current dashboard's pill is `panel` and `ink`, the others `ink-muted`.

### Lock screen
- White type on the photo, in five spots (corners and centre). Time is large, light and tight; all else is a reading over its label. Traffic delay turns `lock-warn` or `lock-danger`.

## Do's and Don'ts

### Do:
- **Do** give every new tile kind one hue pair, 4.5:1 ink on `tile-surface`, and use `ink` on its fill.
- **Do** size everything on a display from `--cell`, keeping 44px as the touch minimum.
- **Do** write in the domain language: Dashboard, Display, Tile, Section, Publish, Draft, Photo set, Account.
- **Do** respect `prefers-reduced-motion`; drop press transitions and slow spinners.
- **Do** set `--sec` on everything that belongs to a place, and open every Management page with the page header: crumbs, mark, title, purpose line, actions.
- **Do** keep the five places in the same order, with the same hues, on every page.
- **Do** head a Management block with a plan label (11px/600, 0.1em, uppercase) and divide its rows with 1px `mgmt-line` hairlines.

### Don't:
- **Don't** recolour a tile for its state. Intensity changes; the hue doesn't. State colour goes on elements inside the tile.
- **Don't** use `brand` on a display tile, or status colours as decoration.
- **Don't** add shadows to Management outside its modal dialogs, or inside a tile.
- **Don't** put a place hue on a button, a link or a focus ring; actions are `mgmt-brand` only.
- **Don't** give a place a hue that can be read as `ok`, `warn` or `danger`.
- **Don't** restyle the editor stage to match Management.
- **Don't** use emoji, exclamation marks, or "please" in copy.
- **Don't** move or reflow tiles on their own; nothing animates except photos and Plex progress.
- **Don't** hard-code one theme.
