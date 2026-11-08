# Weather tile

The weather where a Homey is, or at a town chosen for the tile ([ADR-0013](../../adr/0013-weather-from-open-meteo-and-buienradar.md)), in the `climate` hue.

An `.hd-tile.hd-weather` that gets `.has-forecast` once there is one, and lays out by size with grid areas:

- `.hd-weather__now`: the condition's icon in the tile's chip and the temperature, `.hd-value--m` on small, `--l` from
  wide, and larger on the large sizes.
- `.hd-weather__titles`: the place (the tile's label, its own town, or the town Homey's weather names) and a detail line: `Cloudy · 11° / 4°`, the day's high and low,
  or while rain comes in the next two hours `Rain from 13:10` or `Rain until 13:40`.
- `.hd-weather__ahead`: the coming hours as an `.hd-weather__strip` (3 on wide, 5 on full and large, 6 on full large):
  the hour, an icon, the temperature. On large and full large it charts the rain instead while rain comes:
  `.hd-weather__rain`, a bar per five minutes in `kind-cover-ink`, square-root scaled, over `Now`, in an hour, in two.
- `.hd-weather__days`: the coming days, as a strip, from `Today` (4 on large, 6 on full large), high with the low muted.

Icons are Lucide's weather icons, a sun or moon by day or night. Temperatures are whole degrees with a true minus.

Without a forecast it is a plain tile: `Set a location in Homey`, or why Open-Meteo can't be reached, with `is-unavailable`.

A press opens the full forecast over the whole screen (`.hd-details--screen`), its ground tinted with the hue:
the condition large beside the temperature (`.hd-value--xl`) and `Feels like`; `.hd-stat__figures` for humidity, wind,
sunrise and sunset; the rain chart, headed by when it rains or `Dry for the next 2 hours`, where Buienradar knows; the next
24 hours as a strip that scrolls sideways, with the chance of rain from 20%; the 7 days as rows; and who the forecast is by.

In Management the tile's settings have a **Place** field: `Homey location: {town}` (just `Homey location` until the forecast names the town), or the chosen town with a
`Use where … is` button. A search field under it lists towns from two letters, each with its region and country to tell
namesakes apart; picking one sets it. A tile with a town of its own has no Homey picker.
