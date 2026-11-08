# Energy tile

Homey's own energy report ([ADR-0014](../../adr/0014-energy-from-homeys-own-report.md)): the grid power now, solar and the
home's consumption, and today, in the `energy` hue.

An `.hd-tile.hd-energy` that gets `.has-live` once Homey has told its power, and lays out by size with grid areas:

- `.hd-energy__now`: an arrow icon in the tile's chip (down importing, up exporting, `=` balanced under 10 W) and the grid
  power as the headline (`640 W`, `1.8 kW`), smaller on small and larger on full large.
- `.hd-energy__titles`: the tile's name and `Importing`, `Exporting` or `Balanced`.
- `.hd-energy__figures` (wide up): Solar and Home, a small icon, label and power each; a part Homey doesn't report is left out.
- `.hd-energy__flow` (wide up): a thin bar of where the power comes from: the sun's share of what the home uses
  (`--solar`, the hue), the grid's (`--grid`, muted) and what goes back to the grid (`--export`, the hue faded). Widths are `flex-grow`.
- `.hd-energy__today` (full large only): imported, exported, solar and home in kWh, in two columns.
- `.hd-energy__day` (large up): today by the hour in a 240×60 SVG, `.hd-energy__bar-solar` bars in the hue and a thin
  `.hd-energy__bar-home` mark per hour at the home's use, over `0:00 12:00 24:00`.

Without live power it is a plain tile with `is-unavailable`: `Energy is not shared by Homey` (the API key lacks the energy
scope, or the Homey has no energy), `Cannot reach Homey`, or `Homey not found`.

A press opens today over the whole screen (`.hd-details--screen`, ground tinted with the hue): the grid power as `.hd-value--xl`
with the flow bar, `.hd-stat__figures` for solar and home now and imported, exported, solar and home today, and the hourly
chart with a legend.
