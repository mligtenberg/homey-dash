import { cellSize } from './cell-size';

describe('cellSize', () => {
  it('fills the height exactly with rows, gaps, padding and the section title', () => {
    const cell = cellSize(800, 4);
    const used = cell * (4 + 0.08 * 3 + 0.16 + 0.12 + 0.048);

    expect(used).toBeCloseTo(800);
  });

  it('gives smaller cells for more rows', () => {
    expect(cellSize(800, 5)).toBeLessThan(cellSize(800, 4));
  });

  it('rejects a dashboard without rows', () => {
    expect(() => cellSize(800, 0)).toThrow(RangeError);
  });
});
