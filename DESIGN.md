---
name: HomeyDash
description: Soft, tactile smart-home displays coloured by what each tile controls, inside a flat, quiet Management frame.
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
    fontWeight: 700
    lineHeight: 1.3
  page-title:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
  panel-title:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 800
  section-title:
    fontFamily: "Rubik Variable, Rubik, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 800
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
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  input:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
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

HomeyDash has two faces on one set of tokens. A display is a wall of soft, button-like tiles, read across a room and touched for a second. Management is a flat, quiet utility frame around those same tiles, so the real tiles in the editor are the most colourful thing on screen. Colour belongs to the thing being controlled: every tile kind owns one hue, and nothing else on a display is coloured.

Displays are calm. Nothing moves on its own except a photo fading to the next and a Plex progress bar. When left alone a display turns into a photo frame with a quiet layer of white lock-screen widgets over the picture.

The system follows the device's light or dark preference, and never hard-codes one theme.

**Key Characteristics:**
- Colour means a kind of thing; status colour is only ever status.
- Tiles feel like buttons: one soft lift, controls inside sit flat, a press shrinks the tile.
- Everything on a display scales from one `--cell`, the screen height divided by the row count (4 by default).
- Management is flat, hairline-bordered and has exactly one accent.
- Plain English, sentence case, no emoji or exclamation marks.

## Colors

A cool periwinkle-grey neutral ground carrying ten kind hues, each in a readable ink and a saturated fill. The values listed are the light theme; the dark theme has its own counterpart for every token.

### Primary
- **Management Indigo** (`#4364df`, dark `#85a6ff`): the single Management accent: primary button, selection in the editor, checked controls, the focus ring. Text on it is `on-brand`. Never on a display tile.

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

### Neutral
- **Ground Mist** (`#e4e6ee`): display background and recessed wells.
- **Tile Surface** (`#f1f2f7`): a resting tile. `tile-glass` is the same, see-through, over a blur, for a tile over a background image.
- **Ink** (`#22252f`) and **Ink Muted** (`#5f6477`): primary and secondary text.
- **Hairline** (`#d4d7e2`): Management borders and dividers.
- **Chrome** (`#f7f8fb`) and **Panel** (`#ffffff`): Management background and panel surface.
- **Emboss Shade / Light** (`#c5c8d6` / `#ffffff`): the two ends of a tile's lift.

### Status
- **OK** (`#1c8742`), **Warn** (`#975800`), **Danger** (`#c8364a`): status only, always with a word ("Connected", "Connection lost").
- **Lock Warn / Lock Danger** (`#ffd166` / `#ff9b85`): status on the lock screen. The same in every theme, because the lock screen always lies over a photo.

### Named Rules
**The Kind Hue Rule.** A resting tile carries a light tint of its kind (22% fill over the surface); an active tile fills with it. Inactive tiles stay on `tile-surface` with a tinted icon, so a dashboard is still colourful when everything is off. The share is `--rest-tint`: 22% in light, 36% in dark, where the fills are deep and 22% left heat, security, climate and cover tiles the same grey-blue. Poster and cover art dims to 70% brightness in dark (`--art-dim`), so it is not the brightest thing on a night wall.

**The Status Is Never Decoration Rule.** `ok`, `warn` and `danger` appear only with a word; colour alone never carries state.

**The Brand Stays In Management Rule.** `brand` never appears on a display tile.

## Typography

**Font:** Rubik (variable, from `@fontsource-variable/rubik`) with system-ui fallback, for everything.

**Character:** Round, friendly and sturdy, at heavy weights for values and names so they read across a room.

### Hierarchy
- **Tile value XL** (700, 0.5 × cell): the one hero reading of a Large tile. `value-l` (0.42) and `value-m` (0.24) serve Statistic and Wide tiles. Display sizes are always fractions of `--cell`.
- **Tile name, detail, badge**: fractions of `--cell`; detail lines are short state phrases joined with a middle dot (`On · 80%`).
- **Unit** (600, 0.45em of its value, `ink-muted`): `20.5°C`, `1.84 kW`.
- **Page title** (800, 22px): Management `h1`. Panel title 18px, section title 16px; no other heading sizes.
- **Body** (500, 14px, 1.45): Management text. **Label** (700, 12px): field labels and pills. Only the overline is uppercase.
- **Screen title** (800, 28px, `--text-screen-title`): the one heading on a full-screen state (waiting, Setup). **Touch input** (16px, `--text-touch`): inputs and buttons on Setup and screen settings, never below 16px so iOS does not zoom. Caption 13px (hints, sub lines), item title 15px.
- **Small-text roles** (`--t-caption` .085, `--t-detail` .1, `--t-name` .12, `--t-sub` .145, `--t-title` .17, about 1.2 apart): each is `max(var(--t-x-min), calc(var(--cell) * var(--t-x)))` with floors of 11, 11, 11.5, 14 and 16px (tuned on the 916×610 hardware at 6 rows, where a 12px name breaks "Thermostat" mid-word), so the order caption < detail < name < sub < title holds on a short screen. Detail lines are weight 600, names 700. Every small display text uses one of these five; hero values stay on `--value-scale-*`.
- **Floor**: `--text-floor` (11px) is the caption floor; no display text goes below it.
- **Lock screen**: scales with the viewport height: clock time 13 × 1vh at weight 300, readings 4.6 × 1vh at 500, labels 1.9 × 1vh.

### Named Rules
**The Tabular Figures Rule.** Every number uses tabular figures.

**The Cell Scales Type Rule.** Never use fixed pixels for type on a display, except the 44px minimum on touch controls, the screen title and touch input roles, and the `--text-floor`.

**The Line Break Rule.** Headings and tile names use `text-wrap: balance`; lines of prose (lead, hint, muted) use `text-wrap: pretty`.

## Layout

A display shows a dashboard as sections side by side. A section is 3 cells wide and `rows` tall. Cell size is screen height ÷ rows. Only whole sections that fit the width are shown, centred, as one page; further sections are further pages, swiped between, with a dot per page. On a display with several dashboards, the first 68px on the left is a gutter for the dashboard tape: sections are fitted to and centred in what is left, and a page swiping across the gutter fades out under the tape. A cell only shrinks (by up to 10%) to fit another section when the dashboard has one to show. Tiles snap to a fixed set of sizes (small 1×1, wide 2×1, full 3×1, large 2×2, full-large 3×2, full-tall 3×4), never overlap, never reflow, and dashboards never scroll vertically.

All display measures are ratios times `--cell`: gap 0.08, section gap 0.176, padding 0.11, radius 0.2, icon 0.27, control 0.42.

Management uses the `space-1…6` scale (4–24px). Page bodies are at most 900px (640px narrow). In the editor, tiles render at a fixed `--cell` of 92px.

## Elevation & Depth

Two faces. **Displays** are lifted: every resting tile has one soft shadow (`tile-raised`) and nothing inside a tile has a shadow. **Management** has no shadows; panels get a 1px `line` border instead.

### Shadow Vocabulary
- **Tile raised** (`0 1px 2px emboss-shade@60%, 0 .05·cell .14·cell -.04·cell emboss-shade`): every resting tile.
- **Detail sheet** (`0 .1·cell .4·cell emboss-shade`) over a blurred `emboss-shade` backdrop: a tile's open details.
- **Tape pill** (`0 1px 3px emboss-shade@60%`) with a 12px backdrop blur: the dashboard tape only.
- **Lock screen text** (`0 1px 2px / 0 0 14px / 0 0 36px` black at 55 / 45 / 35%): white type on any photo; each spot also darkens only its own corner.

### Named Rules
**The Press Rule.** A pressed tile scales to 0.96 and darkens slightly. Every pressable surface also shows a ripple from the point of the press.

**The Tinted Not Raised Rule.** Controls (slider track, segmented control, round buttons) are the kind ink at low opacity, never raised. The tile's quick action is the one solid control.

## Shapes

Generous and friendly. Tiles round at 0.2 × cell; Management uses small radii (8px controls, 10px panels, 16px large) and pills (999px) for status and the dashboard tape. Icons are Lucide, drawn duotone: stroke 2 in `currentColor`, closed shapes filled at 22%. No emoji, no filled glyphs.

## Components

### Tile
- **Shape:** 0.2 × cell radius, `tile-raised`, padding 0.11 × cell.
- **States:** Hue is the tile's type and never changes with state; state is the intensity of that hue (rest tint, active fill) plus neutral elements on the tile: the corner button is white when on and grey when off. A lock's state colour (blue locked, yellow unlocked) goes on its icon chip, not the tile. Full model in `docs/design-system/State.md`. Active fills with `kind-*-fill`. Unavailable drops to 60% opacity with a warn "Unavailable" badge. Missing becomes a transparent outline in `line` with a danger icon and "Not found in Homey". Connection lost desaturates the dashboard and stops taps.
- **Focus:** a solid 3px ring in the kind ink, offset 3px.

### Buttons
- **Default:** panel fill, 1px `line` border, 8px radius, 14px/700, padding 10 × 16. Press scales to 0.97. Disabled is 45% opacity.
- **Primary:** `brand` fill, `on-brand` text, no border. **Danger:** text only, in `danger`.
- **Focus:** 3px `brand` ring, offset 2px.

### Inputs / Fields
- `chrome` fill, 1px `line` border, 8px radius, 14px/500. Label above: 12px/700 in `ink-muted`. Errors and hints are 13px.

### Status pill
- 12px/700, pill radius, text in a status colour over the same colour at 14%; an optional leading dot. Always with a word.

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

### Don't:
- **Don't** recolour a tile for its state. Intensity changes; the hue doesn't. State colour goes on elements inside the tile.
- **Don't** use `brand` on a display tile, or status colours as decoration.
- **Don't** add shadows to Management or inside a tile.
- **Don't** use emoji, exclamation marks, or "please" in copy.
- **Don't** move or reflow tiles on their own; nothing animates except photos and Plex progress.
- **Don't** hard-code one theme.
