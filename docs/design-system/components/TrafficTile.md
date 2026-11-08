# Traffic tile

The car travel time on one route now, from TomTom ([ADR-0015](../../adr/0015-traffic-from-tomtom.md)). The hue says the
delay over the usual time at this hour: `climate` (blue) on time, `light` (amber) from 2 minutes and 10% over, `heat` (red)
from 5 minutes and 25% over.

An `.hd-tile.hd-traffic` that gets `.has-traffic` once there is a result, and lays out by size with grid areas:

- `.hd-traffic__now`: a car icon in the tile's chip (left out on small) and the travel time (`24 min`, `1 h 05 min`, the
  unit set smaller with `.hd-unit`), growing with the size. It runs smaller than `.hd-value--m`, as it is wider than a
  temperature.
- `.hd-traffic__titles`: the route's name (its label, or the name chosen with the route) and the delay: `+6 min`, or
  `On time`.
- `.hd-traffic__figures` from wide up, a `.hd-traffic__figure` per line (label muted, value bold): `Distance`, `Arrive`
  (when leaving now arrives) and, from large up, `Usual` (the usual travel time), then when it was `Updated`, or
  `Out of date` while TomTom can't be reached (the tile is then `is-unavailable`, still showing the last time).

Without a result it is a plain tile: `Pick a route`, `Set up TomTom in Management`, or why TomTom can't be reached.
There is no detail view.

In Management the tile's settings have a **TomTom account** picker (only with several accounts), a **Route name** and
**From** / **To** places: each shows the chosen place, with a search field under it that lists places from two letters in a
popover over the settings, each with region and country. The same route field sets the traffic widget of a display's Lock
screen, which shows the time in white (amber or red with a delay) over the photo, with the route name and delay under it.
