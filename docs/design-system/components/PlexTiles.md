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
- A press on a poster opens its details in place of the grid (`.hd-plex-recent__detail`): the artwork faint and blurred behind, a back button, the large poster, then when it was added in gold, the title, subtitle (not when it only repeats the year), a facts line with the rating (gold star, out of ten), year, runtime and a boxed content rating, genre pills and the summary. What Plex doesn't know is left out. A movie or episode ends with a gold `Play on AirPlay` pill ([ADR-0012](../../adr/0012-airplay-in-dotnet.md)): it looks for Apple TVs, offers each as an outlined gold pill, then shows `Playing on …` with a Stop pill; a failure shows in `--danger` under it. While something plays on an Apple TV, a gold-outlined bar (`.hd-plex-recent__now`) stays at the top of the screen, grid or detail: the title, `Playing on …` or `Paused on …`, Pause/Resume and Stop pills, and Audio and Subtitles selects (`.hd-plex-recent__track`) when the item has tracks to choose. It shows on every screen that has the tile, and the tile's face gets a round gold playing badge (`.hd-plex-recent__casting`, a pause icon when paused). The grid has a search field above it (`.hd-plex-recent__search`) that searches the whole library, or the chosen tab's, after two letters; results are cards like the newest, without a date when the server gives none. Back returns to the grid; closing the screen resets it.

## Behavior

- A now-playing tile following any player moves to the next session every 12 seconds when several play.
- A press on a button never opens the detail view. A player that refuses a command makes the tile flash `is-error`, and the detail view says to turn on Advertise as player.
- While the connection to HomeyDash is lost, both keep what they show; progress keeps moving from the last known point.

## Don't

- Don't show anything private beyond who plays where; displays hang in shared rooms.
