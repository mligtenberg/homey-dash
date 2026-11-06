# Plex tiles

Two kinds from the Plex tile module ([ADR-0009](../../adr/0009-plex-tiles-through-homeydash.md)). Both have no kind hue: their artwork is the colour.

## Now playing

An `.hd-tile.hd-plex`. While something plays it gets `.has-art`, loses its padding, turns dark and holds:

- `img.hd-plex__art` filling the tile with `object-fit: cover`: the wide artwork on wide, full and full-large tiles, the poster on small and large ones. A gradient (`::before`) darkens it towards the bottom so the white text reads.
- `.hd-plex__body` at the bottom: `.hd-plex__title` (the tile's label, or the title), `.hd-plex__sub` with the year, show and episode, or artist and album (not on small), and who plays where (large sizes only).
- `.hd-plex__controls`: the time as `1:05:09 / 2:46:00` and `.hd-round-btns` with skip back, play or pause, and skip forward. Small has only play or pause.
- `.hd-plex__progress` along the bottom edge, filled in `--brand`; it moves every second while playing.

Without a session it is a plain tile with the TV icon: `Nothing playing`, `Plex is not set up`, `Choose a Plex server`, or why Plex can't be reached with `is-unavailable`.

The detail view lists every session the tile follows: poster, title, subtitle, who and where, progress and the three buttons each.

## Recently added

An `.hd-tile.hd-plex-recent`. With items it gets `.has-art` and a `.hd-plex-recent__grid` of the newest posters, edge to edge: 1 on small, 2 on wide, 3 on full, 2 × 2 on large, 3 × 2 on full-large. Each has its title and subtitle on a dark gradient at the bottom. A label of the tile's own sits over the whole as `.hd-photo__label`.

The detail view takes the whole screen (`.hd-details--screen`, like Sonos) in Plex's own colours whatever the theme: a charcoal ground with a faint gold glow at the top, white text, and Plex gold (`#e5a00d`) as the accent. It holds:

- In the head, between the title and the close button, a `.hd-segmented` tab per library (`All`, `Movies`, `TV Shows`, …) when the tile covers every library; the active tab is gold with dark text.
- `.hd-plex-recent__pane`: a scrolling grid of the newest 24 posters (2:3, shadowed), each with title, subtitle and, in gold, when it was added (`Today`, `Yesterday`, `3 days ago`, `12 Aug`). Posters added today or yesterday carry a gold `New` badge.

## Behavior

- A now-playing tile following any player moves to the next session every 12 seconds when several play.
- A press on a button never opens the detail view. A player that refuses a command makes the tile flash `is-error`, and the detail view says to turn on Advertise as player.
- While the connection to HomeyDash is lost, both keep what they show; progress keeps moving from the last known point.

## Don't

- Don't show anything private beyond who plays where; displays hang in shared rooms.
