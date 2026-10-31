# Section

A named group of tiles laid out on a grid three cells wide and as many rows tall as the dashboard.

- Use `.hd-section` with an `.hd-section__title`, followed by `.hd-section__grid`. Set `--rows` on the grid from the dashboard; the default is 4.
- Sections sit side by side in `.hd-dashboard`, which scrolls horizontally when they're wider than the screen. Nothing ever scrolls vertically.
- The consumer sets `--cell` on `.hd-display` to `screen height ÷ rows`, after subtracting the dashboard padding and title height. Recompute it on resize.
- Place tiles with explicit `grid-row` and `grid-column` from their tile position. Empty cells stay empty.
