import { findPlacementProblems, fitsInSection, gridArea, PlacedTile } from './section-grid';

const tile = (id: string, column: number, row: number, size: PlacedTile['size']): PlacedTile => ({
  id,
  position: { column, row },
  size,
});

describe('fitsInSection', () => {
  it('accepts a full large tile filling the bottom two rows', () => {
    expect(fitsInSection(tile('a', 0, 2, 'full-large'), 4)).toBe(true);
  });

  it('rejects a wide tile in the last column', () => {
    expect(fitsInSection(tile('a', 2, 0, 'wide'), 4)).toBe(false);
  });

  it('rejects a large tile hanging below the last row', () => {
    expect(fitsInSection(tile('a', 0, 3, 'large'), 4)).toBe(false);
  });

  it('rejects negative and fractional positions', () => {
    expect(fitsInSection(tile('a', -1, 0, 'small'), 4)).toBe(false);
    expect(fitsInSection(tile('a', 0.5, 0, 'small'), 4)).toBe(false);
  });
});

describe('findPlacementProblems', () => {
  it('finds nothing in a section with empty cells between tiles', () => {
    const tiles = [tile('a', 0, 0, 'large'), tile('b', 2, 0, 'small'), tile('c', 0, 3, 'full')];

    expect(findPlacementProblems(tiles, 4)).toEqual([]);
  });

  it('reports a tile overlapping another once', () => {
    const tiles = [tile('a', 0, 0, 'large'), tile('b', 1, 1, 'wide')];

    expect(findPlacementProblems(tiles, 4)).toEqual([{ kind: 'overlap', tileId: 'b', otherTileId: 'a' }]);
  });

  it('reports a tile beyond the grid', () => {
    expect(findPlacementProblems([tile('a', 0, 4, 'small')], 4)).toEqual([
      { kind: 'out-of-bounds', tileId: 'a' },
    ]);
  });
});

describe('gridArea', () => {
  it('converts to one-based CSS grid lines', () => {
    expect(gridArea(tile('a', 1, 2, 'large'))).toEqual({ gridColumn: '2 / span 2', gridRow: '3 / span 2' });
  });
});
