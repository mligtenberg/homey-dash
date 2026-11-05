export type TileSize = 'small' | 'wide' | 'full' | 'large' | 'full-large' | 'full-tall';

export interface Span {
  columns: number;
  rows: number;
}

/** The fixed set of tile sizes, in cells. */
export const TILE_SIZES: Readonly<Record<TileSize, Span>> = {
  small: { columns: 1, rows: 1 },
  wide: { columns: 2, rows: 1 },
  full: { columns: 3, rows: 1 },
  large: { columns: 2, rows: 2 },
  'full-large': { columns: 3, rows: 2 },
  'full-tall': { columns: 3, rows: 4 },
};

export const TILE_SIZE_LABELS: Readonly<Record<TileSize, string>> = {
  small: 'Small',
  wide: 'Wide',
  full: 'Full',
  large: 'Large',
  'full-large': 'Full large',
  'full-tall': 'Full tall',
};
