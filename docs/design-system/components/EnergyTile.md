# Energy tile

Homey's own energy report ([ADR-0014](../../adr/0014-energy-from-homeys-own-report.md)): the grid power now, solar and the
home's consumption, and today, in the `energy` hue.

An `.hd-tile.hd-energy` that gets `.has-live` once Homey has told its power, and lays out by size with grid areas:

- `.hd-energy__now`: an arrow icon in the tile's chip (down importing, up exporting, `=` balanced under 10 W) and the grid
  power as the headline (`640 W`, `1.8 kW`), smaller on small and larger on full large.
- `.hd-energy__titles`: the tile's name and `Importing`, `Exporting` or `Balanced`.
- `.hd-energy__figures` (wide up): Solar and Home, a small icon, label and power each, and Today in kWh where there is no
  solar; a part Homey doesn't report is left out.
- `.hd-energy__flow` (wide up, only with solar): a thin bar of where the power comes from: the sun's share of what the home uses
  (`--solar`, the hue), the grid's (`--grid`, muted) and what goes back to the grid (`--export`, the hue faded). Widths are `flex-grow`.
- `.hd-energy__today` (full large only): used, imported, solar and exported in kWh and the cost, in two columns.
- `.hd-energy__day` (large up): today by the hour in a 240×60 SVG, a `.hd-energy__bar-home` bar per hour in the hue and a
  narrower `.hd-energy__bar-solar` bar in the light kind's amber, over `0:00 6:00 12:00 18:00 24:00`.

Without live power it is a plain tile with `is-unavailable`: `Energy is not shared by Homey` (the API key lacks the energy
scope, or the Homey has no energy), `Cannot reach Homey`, or `Homey not found`.

A press opens today over the whole screen (`.hd-details--screen`, ground tinted with the hue): the grid power as `.hd-value--xl`
with the flow bar, `.hd-stat__figures` for home and solar now, used today (with the average power), the cost (with the price
per kWh when nothing went back), the peak, and solar, imported and exported today with solar. Under them, in
`.hd-energy__section` cards two abreast when there is room: the meter's power through the day as a scrubbable
`hd-statistic-chart` with the peak or the picked moment, the hourly chart with a legend, and `.hd-energy__devices`, the devices
that used the most with a bar each (`--share` of the top one) and how much of the home's use they account for.
