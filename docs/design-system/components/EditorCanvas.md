# EditorCanvas

The editor in Management, where a dashboard's draft is arranged: real tiles on a dotted stage, empty cells to add to, and one selected tile.

- `.hd-stage` sets `--cell: 92px` and holds the same `.hd-section` markup a display uses, so tiles look exactly as they will on a display. They show real content but can't be operated.
- Empty cells are `.hd-slot` buttons. Pressing one opens the tile kind chooser for that position.
- The selected tile gets `.is-selected`, a `brand` outline, and an `.hd-handle` at its bottom-right corner for resizing. Its settings show in the panel next to the canvas.
- Tiles never overlap and never extend beyond the grid. Refuse moves and resizes that would break this.
