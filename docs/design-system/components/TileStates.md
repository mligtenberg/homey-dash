# TileStates

How a tile looks when its target in Homey can't be reached (Unavailable) or no longer exists (Missing).

- **Unavailable** (`.is-unavailable`): the tile keeps its last known value at 60% opacity, with a `.hd-badge` reading "Unavailable" in `warn`. It recovers on its own.
- **Missing** (`.is-missing`): the tile becomes a transparent outline, with "Not found in Homey" in `danger`. Leave out `data-kind`. Management flags every dashboard that contains a missing tile. The tile is never removed automatically.

Don't hide either state, and don't swap in a generic error tile. The user needs to recognize which tile it is.
