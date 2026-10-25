# StatisticTile

The history of one recorded value over a time window, with its current value, updating live.

- Use `.hd-tile.hd-stat` with `.hd-stat__head` (name and window on the left, `.hd-value--l` on the right) above an `.hd-chart` SVG.
- The consumer draws the chart: an `.hd-chart__area`, an `.hd-chart__line`, an `.hd-chart__dot` on the latest point, two or three `.hd-chart__grid` lines at round values, and three or four `.hd-chart__axis` labels.
- Use `energy` for power and `climate` for temperature, or the kind of the device the value belongs to.
- Sizes: `large` or `full-large`. Below that, a single value fits a regular device tile better.
