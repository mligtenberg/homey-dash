# HomeyDash design system

The live version, with token tables and component previews, is the HomeyDash Design System artifact: https://claude.ai/artifact/UdF3PKMzMDPhFxADL6W9or

The code lives in `libs/design-system`: `tokens.css` (colors per theme, spacing, radii, cell ratios, font), `components.css` (the `hd-*` classes) and `index.css`, which both apps load as a global style. Per-component guidelines are in [components/](components/).

HomeyDash is a smart-home control surface for a Homey hub. It has two faces: **displays**, the touch screens placed around the home, and **Management**, the app where dashboards are built and displays are assigned. Both share one set of tokens and one tile vocabulary. Displays are soft, tactile and colored by what each tile controls. Management is a flat, quiet utility frame around those same tiles.

## Principles

- **Glanceable first.** A display is read from a distance and touched for a second. Large tiles carry one big value that reads across the room. Small tiles are read at arm's length.
- **Color means a kind of thing.** Every tile kind owns one hue. An active tile fills with that hue. Nothing else on a display is colored.
- **Tiles feel like buttons.** Tiles are embossed. Pressing a tile sinks it.
- **Nothing moves on its own.** Tiles never reflow and dashboards never scroll vertically. Motion is limited to press feedback and state changes.
- **Management stays out of the way.** Management uses flat panels with hairline borders and one accent, `brand`, so the real tiles in the editor are the most colorful thing on screen.

## Words

Use the domain language from `CONTEXT.md` in all UI copy. Users see these words.

| Say | Never |
| --- | --- |
| Dashboard | page, screen, view |
| Display | screen, device, kiosk |
| Tile | card, widget |
| Section | group, panel |
| Publish | deploy, save, release |
| Draft / Unpublished changes | work in progress |
| Connection lost | offline, disconnected |
| Unavailable (target can't be reached) | offline |
| Not found in Homey (target is gone) | broken, deleted |

- Write in plain English, sentence case: "Movie night", "Reading lamp", "Unpublished changes".
- Tile detail lines are short state phrases joined with a middle dot: `On · 80%`, `Closed · 2 h ago`, `Cotton 40° · Rinsing`.
- Buttons say exactly what happens: **Publish**, **Preview**, **Remove tile**. After the action, report it in the past tense, for example "Published".
- Flow and mood tiles confirm briefly in their detail line, with **Started** or **Activated**, then return to rest.
- Don't use emoji, exclamation marks, or "please".

## Color

Colors are semantic tokens with a `light` and a `dark` theme. A display follows the device's color-scheme preference. Never hard-code one theme.

**Display neutrals.** `ground` is the display background and the fill of recessed wells. `tile-surface` is a resting tile. `ink` is primary text, and `ink-muted` is secondary text on `ground` and `tile-surface`. The emboss is drawn from `emboss-shade` and `emboss-light`.

**Kind hues.** Each tile kind has a pair:

- `kind-*-ink` colors the icon, the chart line, slider fills and status chips. Its contrast is 4.5:1 on `tile-surface` and 3:1 on its own fill.
- `kind-*-fill` is the background of an active tile. Text on it is always `ink`, never `ink-muted`.

| Kind | Used for |
| --- | --- |
| `light` (amber) | lights, dimmers |
| `heat` (orange) | heating, thermostats |
| `flow` (teal) | flow tiles |
| `mood` (violet) | mood tiles |
| `security` (green) | locks, doors, motion |
| `energy` (blue) | power and energy |
| `cover` (cyan) | curtains, blinds |
| `appliance` (teal-cyan) | TV, washing machine, speakers |
| `climate` (sky) | temperature/humidity sensors |
| `neutral` (periwinkle) | anything without its own hue |

A tile counts as active when its device is on, running, open or heating, or for a moment after a flow or mood is triggered. Inactive tiles stay on `tile-surface` with a tinted icon, so a dashboard is still colorful when everything is off.

**Status.** `ok`, `warn` and `danger` are for status only, never decoration. A status always comes with a word, such as "Connected" or "Connection lost". Never rely on color alone, because `ok` and `danger` differ mostly in hue.

**Management.** `chrome` is the app background and `panel` is the surface of panels and tables. `brand` is the single accent. Use it for the primary button, the selection in the editor, checked controls and the focus ring. Text on `brand` is `on-brand`. `brand` never appears on a display tile.

## Type

Use one family, Rubik, from Google Fonts: `font-sans`.

- **Display type scales with the cell.** Every size is a fraction of `--cell`, and the type tokens list them at a 200px cell. Use `tile-value-xl` (0.62 × cell) for the one hero reading of a Large tile. Use `tile-value-l` and `tile-value-m` for values on Statistic and Wide tiles. Use `tile-name`, `tile-detail` and `tile-badge` for labels.
- Set a unit at 0.45em of its value, weight 600, in `ink-muted`: `20.5°C`, `1.84 kW`, `42 min left`.
- Numbers always use tabular figures.
- **Management** uses fixed sizes: `page-title`, `panel-title`, `body`, `body-strong`, `label` and `overline`. Only `overline` is uppercase.

## Layout

A display shows a dashboard as sections side by side. Each section is a grid 3 cells wide and `rows` tall. The cell size is the screen height divided by the row count, and the default is **4 rows**. Every display measurement is a ratio from the Cell tokens times `--cell`:

- `cell-gap`: the gap between tiles.
- `tile-padding`: the padding inside a tile.
- `tile-radius`: the tile corner radius.
- `icon-size`: the size of a tile's icon.
- `control-size`: the size of a tile's round buttons.

Never use fixed pixels on a display, except for the 44px minimum on touch controls.

Tile sizes come from a fixed set, set on `data-size`:

| Size | Cells |
| --- | --- |
| `small` | 1×1 |
| `wide` | 2×1 |
| `full` | 3×1 |
| `large` | 2×2 |
| `full-large` | 3×2 |

Within a section, tiles never overlap and never move on their own.

Management uses the `space-*` and `radius-*` tokens. In the editor, tiles render at a fixed `--cell` of 92px inside `hd-stage`.

## Depth and states

Depth and pressing:

- **Raised.** Every resting tile, and every round button inside a tile, uses the `tile-raised` emboss.
- **Pressed.** A pressed tile scales to `press-scale` and switches to `tile-pressed`. Recessed wells, such as the slider track and the segmented control, use `tile-pressed` permanently.
- **Management has no shadows.** Panels get a 1px `line` border instead.

Tile states:

- **Active.** The tile background becomes `kind-*-fill`.
- **Unavailable.** The tile drops to 60% opacity, shows its last known value, and carries an "Unavailable" badge in `warn`.
- **Missing.** The tile becomes a transparent outline in `line`. The icon and the detail "Not found in Homey" are in `danger`. Missing tiles are never removed automatically.
- **Connection lost.** The whole dashboard desaturates and stops responding to taps, though it can still scroll horizontally. A "Reconnecting…" pill sits at the bottom center.

## Iconography

Use [Lucide](https://lucide.dev) icons (`lucide-angular`), drawn **duotone**:

- Draw the outline at stroke width 2 in `currentColor`.
- Fill closed shapes with the same color at 22% opacity. The `.hd-icon` class applies all of this.

On a tile, the icon takes the kind's `kind-*-ink`. In Management, icons are `ink-muted`, or `brand` when selected. Don't use emoji or filled glyph icons.

The icons in these previews were drawn to match Lucide. Use the real Lucide set in the app. There is no logo yet, so set the name "HomeyDash" in `font-sans` at weight 800.

## Accessibility

- Text pairs meet 4.5:1 and icons meet 3:1 in both themes. Every usage note names the backgrounds a color is safe on.
- Keyboard focus shows a solid 3px ring in `brand` in Management, and in `kind-*-ink` around a display tile.
- Touch controls are at least 44px, even at small cell sizes.
- Respect `prefers-reduced-motion`: drop press transitions and slow down the reconnecting spinner.

## Using it in the Angular apps

Both `display` and `management` load `libs/design-system/src/index.css` (the Rubik font, `tokens.css` and `components.css`) as a global style. Set `--cell` on the display's root from `innerHeight / rows`, and add the `hd-display` class to that root. The component guidelines name the classes and data attributes each component expects. They are plain CSS, with no JavaScript bundle.
