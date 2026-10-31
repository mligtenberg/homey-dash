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
