# Tile

The cell-sized surface every tile kind is built on, with a size, a kind hue and a resting or active state. It rests on one soft lift and carries a light tint of its hue.

## Markup

`<div class="hd-tile" data-kind="light" data-size="small">` holding an `.hd-icon` SVG and a block with `.hd-tile__name` and `.hd-tile__detail`. Place it inside an `.hd-section__grid`. It inherits `--cell` from `.hd-display`.

- `data-size`: `small`, `wide`, `full`, `large` or `full-large`. Only use sizes the tile kind's module declares.
- `data-kind`: `light`, `heat`, `flow`, `mood`, `security`, `energy`, `cover`, `appliance` or `climate`. Leave it out to get `neutral`. It sets `--k-ink` and `--k-fill` for everything inside.
- `.is-active`: the device is on, running, open or heating. Fills the tile with `kind-*-fill`; at rest it is `kind-*-fill` at 22% over `tile-surface`.
- The tile's own `.hd-icon` sits in a rounded chip.
- `data-tap` with `tabindex="0"` and `role="button"`: a tap anywhere but on a control opens the tile's [TileDetails](TileDetails.md), with press feedback: the tile shrinks and a [Ripple](Ripple.md) spreads from the press. A press on a control ripples the control instead.

## Do

- Keep the name to two short words where you can. It wraps to two lines at most and ends in an ellipsis beyond that. The detail line is one line, also with an ellipsis.
- Write the detail line as a state phrase: `On · 80%`, `Off`, `Locked`.

## Don't

- Don't set any color directly. Everything comes from the kind.
- Don't make a tap on the tile itself act on its target. A quick action goes on an `.hd-round-btn` in the top right corner.
