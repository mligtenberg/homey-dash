# TileDetails

The detail view of a tile: a modal over the whole screen with everything about its target and all of its controls, whatever the tile's size. It is how a small tile, which has no room for inline controls, is still fully usable.

## Markup

A native `<dialog class="hd-details">`, opened with `showModal()`, placed inside the `.hd-tile` it belongs to so it takes the tile's kind hue. Inside it, one `.hd-details__panel` that fills it:

- `.hd-details__head`: the tile's `.hd-icon`, an `h2.hd-details__name` with a `.hd-details__sub` line below it, and a close button, `.hd-round-btn.hd-details__close` with `aria-label="Close"`.
- Then the body, by kind:
  - Device: a `.hd-details__state` line (`On · 80%`, `Unavailable`) and every control it has. On/off is an `Off`/`On` `.hd-segmented`. Brightness is a `.hd-details__row` with the percentage, then an `.hd-slider`. A thermostat is a `.hd-details__row` with the measured temperature, `Set to 21°C` and the `−`/`+` `.hd-round-btns`. A cover is the `Up`/`Stop`/`Down` `.hd-segmented`. Other readings go in a `dl.hd-details__readings`.
  - Statistic: the current value as `.hd-value--xl` and a tall `.hd-chart`.

The dialog sets a bigger `--cell`, so the shared controls scale up to large touch targets on their own.

## Opening

- A tap anywhere on a tile, or Enter or Space on it, opens its details.
- Details only open when they show more than the tile. A view that would repeat the tile's own button is left out, and a tap on such a tile does nothing.
  - A tile kind turns its detail view off in its definition (`details: false`), as flow, mood and [MoodListTile](MoodListTile.md) tiles do: their play buttons are all there is.
  - A device tile has details only when they add something: a control the tile has no room for (a small dimmer's slider, a small thermostat's buttons), a reading besides the one it shows, or why the device is unavailable. A plain plug or a single-reading sensor has none.
- Controls on the tile never open them. That includes the corner button of a tile with a quick action (a light's power button, a flow's or mood's play button), which acts at once.
- A tile whose target is not picked, not loaded or missing has no details.

## Closing

The close button, Escape, or a tap on the backdrop closes it. A drag that started on a control and ended outside the panel doesn't. On a wall tablet nobody may be there to close it, so it also closes after a minute without a touch.

## Don't

- Don't open a second dialog from the details.
- Don't put settings in it. It operates the target; Management configures the tile.
