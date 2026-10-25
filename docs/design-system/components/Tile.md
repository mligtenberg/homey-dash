# Tile

The embossed, cell-sized surface every tile kind is built on, with a size, a kind hue and a resting or active state.

## Markup

`<div class="hd-tile" data-kind="light" data-size="small">` holding an `.hd-icon` SVG and a block with `.hd-tile__name` and `.hd-tile__detail`. Place it inside an `.hd-section__grid`. It inherits `--cell` from `.hd-display`.

- `data-size`: `small`, `wide`, `full`, `large` or `full-large`. Only use sizes the tile kind's module declares.
- `data-kind`: `light`, `heat`, `flow`, `mood`, `security`, `energy`, `cover`, `appliance` or `climate`. Leave it out to get `neutral`. It sets `--k-ink` and `--k-fill` for everything inside.
- `.is-active`: the device is on, running, open or heating. Fills the tile with `kind-*-fill`.
- `data-tap` with `tabindex="0"` and `role="button"`: makes the whole tile one tap action, with press feedback.

## Do

- Keep the name to two short words where you can. It wraps to two lines at most.
- Write the detail line as a state phrase: `On · 80%`, `Off`, `Locked`.

## Don't

- Don't set any color directly. Everything comes from the kind.
- Don't put a tap action and inline controls on the same tile.
