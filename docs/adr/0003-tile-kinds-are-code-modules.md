# Tile kinds come from modules written in code

A module is a self-contained unit of code that registers one or more tile kinds. For each kind it declares the supported tile sizes (a subset of the fixed set Small, Wide, Full, Large, Full large), its target and configuration, its rendering, and its interaction (tap action or inline controls). A new kind of tile means writing a new module; dashboards, Management and storage stay unchanged because each tile stores its kind plus that kind's own settings.

## Considered Options

- **Tiles composed in Management from building blocks** (source × presentation × aggregation). Rejected: it turns Management into a small BI tool, and most combinations make no sense on a wall tablet.
- **Third-party plugins loaded at runtime.** Rejected: it only pays off if other people will use HomeyDash.

## Consequences

- Tiles render in the display app and in the Management editor and preview, so modules and the cell-size layout logic live in shared libraries, not inside one app.
- A tile's content uses only relative units (rem/em, %). Each display sets its root font size from its cell size, and recalculates on every resize and orientation change, so a tile scales correctly on every screen. Every module must follow this rule.
- In the Management editor, an overlay covers each tile, so modules never need edit-mode logic of their own.
