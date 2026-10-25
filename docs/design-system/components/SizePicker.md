# SizePicker

Picks a tile size from the fixed set. Sizes the tile kind doesn't support are disabled, not hidden.

- `.hd-sizes` always holds five buttons in order: Small, Wide, Full, Large, Full large. Each has a little shape diagram and a label.
- The selected size has `aria-pressed="true"`. Disable the sizes the tile kind's module doesn't declare, and the sizes that wouldn't fit at the tile's position.
