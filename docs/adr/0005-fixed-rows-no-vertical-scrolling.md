# Dashboards have a fixed number of rows and never scroll vertically

A dashboard has a fixed number of rows that every section shares. Sections are three cells wide and sit side by side in a single horizontal row. A cell's size is the display's screen height divided by the dashboard's number of rows, so a dashboard always fills the screen height exactly. When the sections are wider than the screen, the dashboard scrolls horizontally. This gives every display the same composition at any screen size, and wall screens never need vertical scrolling.

## Considered Options

- **A row count per section, with the tallest section deciding the cell size.** Rejected: shorter sections leave unexplained space; empty cells give that control explicitly.
- **A fixed pixel size for cells.** Rejected: a dashboard that fits one tablet is cut off on another.
- **Stacking sections vertically on narrow screens.** Rejected in favour of horizontal scrolling, so nothing ever scrolls vertically.

## Consequences

Tiles have explicit positions and sizes in cells; nothing reflows. Tile content must scale with the cell size ([ADR-0003](0003-tile-kinds-are-code-modules.md)).
