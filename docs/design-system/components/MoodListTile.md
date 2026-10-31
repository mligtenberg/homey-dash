# MoodListTile

Several moods on one tile, with one button for each. A press on a button activates its mood. It suits a room where people switch between a few moods, such as `Living room` with `Dinner`, `Movie night` and `Reading`.

## Markup

An `.hd-tile` with `data-kind="mood"` and no `.hd-icon`, holding:

- An `.hd-row` with the `.hd-tile__name` (the tile's label, or `Moods`) and, on the right, the `.hd-tile__detail`. The detail line is empty at rest. When the moods take more than one page, `.hd-mood-list__dots` stands there instead, an `.hd-page-dot` per page, until a press shows its outcome.
- `.hd-mood-list`, a strip of `.hd-mood-list__page`s that swipes and snaps like the dashboard, with one `button.hd-mood-list__btn` per mood in the order picked in Management. Each button is labeled `Activate <mood>` and washed in its mood's colours (below).

A page holds 4 moods (2 × 2) on a `wide` tile, 6 (3 × 2) on `full`, 10 (2 × 5) on `large` and 15 (3 × 5) on `full-large`, in buttons a quarter cell high. Further moods go on the next page. Content never overflows the tile and buttons never shrink.

A button carries a hint of the colours its mood sets: the tile sets `--mood-tint` to a gradient of up to three of them, a colour light's hue (paler as it is less saturated) or a white from cool to warm, and the button lays it under its name at 35% opacity. Lights of about the same colour count once. Pressed, the colours light up in full on the button, and the whole tile glows in them (`.has-glow`, with `--glow-tint`) under a veil of the surface while it flashes. A mood that sets no colour shows the plain tint and lights up in the kind's ink; a disabled button shows no colours.

## Behavior

- On press: the tile flashes `.is-feedback` as an [ActionTile](ActionTile.md) does, the pressed button gets `.is-pressed`, and the detail line says `<mood> activated`. After about 1.4 seconds all three go back to rest. On failure the line says `Could not activate <mood>` in `danger`.
- The kind has no [TileDetails](TileDetails.md). Its kind definition sets `details: false`, so a tap beside the buttons does nothing, and the tile gets no `data-tap`, `role` or `tabindex`.
- A mood Homey no longer has keeps its place as a disabled button labeled `Not found`. When none of the moods are found, the whole tile shows `is-missing`.
- A swipe inside the tile pages its moods and never moves the dashboard (`overscroll-behavior-x: contain`). A tap on a dot goes to its page.

## Don't

- Don't use it for one mood. A [Mood tile](ActionTile.md) does that and has a detail view.
- Don't hide the moods used most on a later page. Put them first, or pick a size whose first page holds them.
