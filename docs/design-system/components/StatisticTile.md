# StatisticTile

The history of one recorded value over a time window, with its current value, updating live.

- Use `.hd-tile.hd-stat` with `.hd-stat__head` (name and window on the left, `.hd-value--l` on the right) above an `.hd-chart` SVG.
- The consumer draws the chart: an `.hd-chart__area`, an `.hd-chart__line`, an `.hd-chart__dot` on the latest point, two or three `.hd-chart__grid` lines at round values, and three or four `.hd-chart__axis` labels. The value labels get a gutter right of the plot, so the line never runs under them.
- Use `energy` for power and `climate` for temperature, or the kind of the device the value belongs to.
- Sizes: `large` or `full-large`. Below that, a single value fits a regular device tile better.

On a `large` tile the current value is `.hd-value--m`, so the name keeps room beside it; `full-large` uses `.hd-value--l`.

A tap opens the [TileDetails](TileDetails.md) with the current value and a bigger chart. There, `.hd-chart--scrub` lets a press or drag along the chart pick a moment: an `.hd-chart__cursor` line and the dot mark it, and the `.hd-stat__readout` above shows its value and time instead of `Now`.
