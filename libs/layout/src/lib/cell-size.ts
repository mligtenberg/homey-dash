import { SECTION_COLUMNS } from './section-grid';

export const DEFAULT_ROWS = 4;

// Ratios of --cell, mirroring tokens.css and the .hd-dashboard / .hd-section rules in components.css.
const CELL_GAP = 0.08;
const SECTION_GAP = 0.176;
const DASHBOARD_PADDING = CELL_GAP;
// The strip under the sections that holds the page dots.
const PAGE_DOTS_HEIGHT = 0.2;
const SECTION_TITLE_HEIGHT = 0.1 * 1.2;
const SECTION_TITLE_GAP = CELL_GAP * 0.6;
const SECTION_WIDTH = SECTION_COLUMNS + CELL_GAP * (SECTION_COLUMNS - 1);

/**
 * The cell size that makes a dashboard of `rows` rows exactly fill `height` pixels.
 * Padding, section titles, gaps and the page dots all scale with the cell, so the
 * whole column is a fixed multiple of it.
 */
export function cellSize(height: number, rows: number = DEFAULT_ROWS): number {
  if (rows < 1) throw new RangeError(`A dashboard needs at least one row, got ${rows}`);
  const cellsTall =
    rows +
    CELL_GAP * (rows - 1) +
    DASHBOARD_PADDING +
    PAGE_DOTS_HEIGHT +
    SECTION_TITLE_HEIGHT +
    SECTION_TITLE_GAP;
  return height / cellsTall;
}

/**
 * How many sections fit side by side, whole, in `width` pixels at `cell` pixels per cell.
 * Always at least one, so a screen narrower than a section still shows something.
 */
export function sectionsPerPage(width: number, cell: number): number {
  const room = width / cell - 2 * DASHBOARD_PADDING;
  return Math.max(1, Math.floor((room + SECTION_GAP) / (SECTION_WIDTH + SECTION_GAP) + 1e-9));
}

/** How far the cell may shrink (as a fraction of its height-fitted size) to make one more section fit. */
export const MAX_CELL_SHRINK = 0.1;

/**
 * Like `cellSize`, but when shrinking the cell by up to 10% lets one more whole section fit
 * across `width`, shrinks it just enough for that, so the extra section takes the space.
 */
export function fittedCellSize(width: number, height: number, rows: number = DEFAULT_ROWS): number {
  const cell = cellSize(height, rows);
  const next = sectionsPerPage(width, cell) + 1;
  const widest = width / (2 * DASHBOARD_PADDING + next * SECTION_WIDTH + (next - 1) * SECTION_GAP);
  return widest >= cell * (1 - MAX_CELL_SHRINK) ? widest : cell;
}
