export const DEFAULT_ROWS = 4;

// Ratios of --cell, mirroring tokens.css and the .hd-dashboard / .hd-section rules in components.css.
const CELL_GAP = 0.08;
const DASHBOARD_PADDING = CELL_GAP;
const SECTION_TITLE_HEIGHT = 0.1 * 1.2;
const SECTION_TITLE_GAP = CELL_GAP * 0.6;

/**
 * The cell size that makes a dashboard of `rows` rows exactly fill `height` pixels.
 * Padding, section titles and gaps all scale with the cell, so the whole column is
 * a fixed multiple of it.
 */
export function cellSize(height: number, rows: number = DEFAULT_ROWS): number {
  if (rows < 1) throw new RangeError(`A dashboard needs at least one row, got ${rows}`);
  const cellsTall =
    rows +
    CELL_GAP * (rows - 1) +
    2 * DASHBOARD_PADDING +
    SECTION_TITLE_HEIGHT +
    SECTION_TITLE_GAP;
  return height / cellsTall;
}
