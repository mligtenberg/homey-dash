import { DashboardLayout, Tile } from '@homey-dash/api-client';
import { TileSize } from '@homey-dash/layout';
import {
  addTile,
  closestSize,
  emptyCells,
  fits,
  moveSection,
  moveTile,
  removeTile,
  resizeTile,
  setRows,
  setSectionVisibility,
} from './draft-edits';

const tile = (id: string, column: number, row: number, size: TileSize): Tile => ({
  id,
  kind: 'device',
  size,
  position: { column, row },
  settings: { target: null },
});

const layout = (...tiles: Tile[]): DashboardLayout => ({
  rows: 4,
  sections: [
    { id: 's1', title: 'Living room', tiles },
    { id: 's2', title: 'Kitchen', tiles: [] },
  ],
});

const device = { id: 'device', sizes: ['small', 'wide', 'large'] as TileSize[], defaultSettings: { target: null } };

describe('addTile', () => {
  it('uses the first size of the kind that fits', () => {
    const result = addTile(layout(tile('a', 1, 0, 'small')), 's1', { column: 0, row: 0 }, { ...device, sizes: ['wide', 'small'] });

    const added = result!.layout.sections[0].tiles.find((t) => t.id === result!.tileId)!;
    expect(added.size).toBe('small');
  });

  it('refuses a kind with no size that fits', () => {
    expect(addTile(layout(), 's1', { column: 2, row: 3 }, { ...device, sizes: ['wide'] })).toBeNull();
  });

  it('copies the default settings so tiles do not share them', () => {
    const first = addTile(layout(), 's1', { column: 0, row: 0 }, device)!;
    const second = addTile(first.layout, 's1', { column: 0, row: 1 }, device)!;

    const [a, b] = second.layout.sections[0].tiles;
    expect(a.settings).not.toBe(b.settings);
  });
});

describe('moveTile', () => {
  it('moves a tile onto cells it already partly covers', () => {
    const moved = moveTile(layout(tile('a', 0, 0, 'large')), 'a', 's1', { column: 1, row: 1 });

    expect(moved!.sections[0].tiles[0].position).toEqual({ column: 1, row: 1 });
  });

  it('moves a tile to another section', () => {
    const moved = moveTile(layout(tile('a', 0, 0, 'small')), 'a', 's2', { column: 2, row: 3 })!;

    expect(moved.sections[0].tiles).toEqual([]);
    expect(moved.sections[1].tiles[0].position).toEqual({ column: 2, row: 3 });
  });

  it('refuses a move onto another tile or beyond the grid', () => {
    const start = layout(tile('a', 0, 0, 'small'), tile('b', 1, 0, 'small'));

    expect(moveTile(start, 'a', 's1', { column: 1, row: 0 })).toBeNull();
    expect(moveTile(start, 'a', 's1', { column: 0, row: 4 })).toBeNull();
  });
});

describe('resizing', () => {
  it('refuses a size that would overlap a neighbour', () => {
    expect(resizeTile(layout(tile('a', 0, 0, 'small'), tile('b', 1, 0, 'small')), 'a', 'wide')).toBeNull();
  });

  it('picks the closest supported size that fits', () => {
    const start = layout(tile('a', 0, 0, 'small'));

    expect(closestSize(start, 'a', device.sizes, { columns: 3, rows: 2 })).toBe('large');
    expect(closestSize(start, 'a', device.sizes, { columns: 1, rows: 1 })).toBe('small');
  });
});

describe('rows', () => {
  it('refuses fewer rows when a tile would fall off', () => {
    expect(setRows(layout(tile('a', 0, 3, 'small')), 3)).toBeNull();
    expect(setRows(layout(tile('a', 0, 2, 'small')), 3)!.rows).toBe(3);
  });
});

describe('sections', () => {
  it('swaps a section with its neighbour and ignores moves past the ends', () => {
    expect(moveSection(layout(), 's2', -1).sections.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(moveSection(layout(), 's1', -1).sections.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('sets whether displays show a section', () => {
    const rule = { match: 'all' as const, conditions: [] };
    const hidden = setSectionVisibility(layout(), 's2', { hidden: true });
    const ruled = setSectionVisibility(hidden, 's2', { rule });

    expect(hidden.sections.map((s) => !!s.hidden)).toEqual([false, true]);
    expect(ruled.sections[1]).toMatchObject({ hidden: false, rule });
    expect(setSectionVisibility(ruled, 's2', {}).sections[1]).toMatchObject({ hidden: false, rule: null });
  });

  it('lists the cells no tile covers', () => {
    const cells = emptyCells(layout(tile('a', 0, 0, 'full-large')), layout().sections[0]);

    expect(cells).toHaveLength(6);
    expect(cells[0]).toEqual({ column: 0, row: 2 });
  });
});

it('a removed tile frees its cells', () => {
  const start = layout(tile('a', 0, 0, 'small'));

  expect(fits(removeTile(start, 'a'), 's1', { column: 0, row: 0 }, 'small')).toBe(true);
});
