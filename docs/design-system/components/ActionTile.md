# ActionTile

A Flow or Mood tile: its play button, in the top right corner, starts a Homey flow or activates a mood.

- `data-kind="flow"` for flows, `data-kind="mood"` for moods.
- Resting detail line: `Flow` or `Mood`, or a short description such as `Mood · lights off, heating 16°`.
- The play button is an `.hd-round-btn.hd-tile__action` with a Lucide `play` icon, labeled `Start` or `Activate`, in an `.hd-row.hd-row--top` with the tile's icon.
- On press: add `.is-feedback` and change the detail line to `Started` (flow) or `Activated` (mood). After about 1.4 seconds, remove the class and restore the line.
- Flows and moods have no on/off state. Never leave one active.
- Neither has a detail view (their kinds set `details: false`): the play button is all there is, and a tap anywhere else does nothing.
- A mood tile is washed in its mood's colours: `.has-tint`, with `--tile-tint` set to the same gradient a [MoodListTile](MoodListTile.md) button gets, under a veil of the surface. While it confirms a press, the veil thins and the tile glows in those colours. The play button keeps the mood purple. A mood that sets no colour keeps the plain mood fill.
- For several moods on one tile, use the [MoodListTile](MoodListTile.md).
