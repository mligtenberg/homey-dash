import { TILE_SIZES, TileSize } from './tile-size';

/** Columns in every section's grid. */
export const SECTION_COLUMNS = 3;

/** The cell of a tile's top-left corner, zero-based. */
export interface TilePosition {
  column: number;
  row: number;
}

export interface PlacedTile {
  id: string;
  position: TilePosition;
  size: TileSize;
}

export type PlacementProblem =
  | { kind: 'out-of-bounds'; tileId: string }
  | { kind: 'overlap'; tileId: string; otherTileId: string };

/** Every cell a tile covers, as `"column,row"` keys. */
function coveredCells({ position, size }: PlacedTile): string[] {
  const span = TILE_SIZES[size];
  const cells: string[] = [];
  for (let c = 0; c < span.columns; c++) {
    for (let r = 0; r < span.rows; r++) {
      cells.push(`${position.column + c},${position.row + r}`);
    }
  }
  return cells;
}

export function fitsInSection(tile: Omit<PlacedTile, 'id'>, rows: number): boolean {
  const { position, size } = tile;
  const span = TILE_SIZES[size];
  return (
    Number.isInteger(position.column) &&
    Number.isInteger(position.row) &&
    position.column >= 0 &&
    position.row >= 0 &&
    position.column + span.columns <= SECTION_COLUMNS &&
    position.row + span.rows <= rows
  );
}

/** Tiles in a section never extend beyond its grid and never overlap. */
export function findPlacementProblems(tiles: readonly PlacedTile[], rows: number): PlacementProblem[] {
  const problems: PlacementProblem[] = [];
  const owner = new Map<string, string>();

  for (const tile of tiles) {
    if (!fitsInSection(tile, rows)) {
      problems.push({ kind: 'out-of-bounds', tileId: tile.id });
      continue;
    }
    const overlapping = new Set<string>();
    for (const cell of coveredCells(tile)) {
      const other = owner.get(cell);
      if (other) overlapping.add(other);
      else owner.set(cell, tile.id);
    }
    for (const otherTileId of overlapping) {
      problems.push({ kind: 'overlap', tileId: tile.id, otherTileId });
    }
  }
  return problems;
}

/** CSS grid placement for a tile, one-based as CSS expects. */
export function gridArea({ position, size }: Omit<PlacedTile, 'id'>): { gridColumn: string; gridRow: string } {
  const span = TILE_SIZES[size];
  return {
    gridColumn: `${position.column + 1} / span ${span.columns}`,
    gridRow: `${position.row + 1} / span ${span.rows}`,
  };
}
