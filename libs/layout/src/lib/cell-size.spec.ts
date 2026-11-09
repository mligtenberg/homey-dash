import { cellSize, fittedCellSize, sectionsPerPage } from './cell-size';

describe('cellSize', () => {
  it('fills the height exactly with rows, gaps, padding, the section title and the page dots', () => {
    const cell = cellSize(800, 4);
    const used = cell * (4 + 0.08 * 3 + 0.08 + 0.2 + 0.12 + 0.048);

    expect(used).toBeCloseTo(800);
  });

  it('gives smaller cells for more rows', () => {
    expect(cellSize(800, 5)).toBeLessThan(cellSize(800, 4));
  });

  it('rejects a dashboard without rows', () => {
    expect(() => cellSize(800, 0)).toThrow(RangeError);
  });
});

describe('sectionsPerPage', () => {
  // A section is 3.16 cells wide, sections are 0.176 apart and the dashboard has 0.08 padding each side.
  const twoSections = 0.08 * 2 + 3.16 * 2 + 0.176;

  it('fits a section only when the whole section fits', () => {
    expect(sectionsPerPage(twoSections * 100, 100)).toBe(2);
    expect(sectionsPerPage(twoSections * 100 - 1, 100)).toBe(1);
  });

  it('shows one section on a screen narrower than a section', () => {
    expect(sectionsPerPage(200, 100)).toBe(1);
  });
});

describe('fittedCellSize', () => {
  const width = (sections: number, cell: number) => (0.08 * 2 + 3.16 * sections + 0.176 * (sections - 1)) * cell;

  it('shrinks the cell to fit one more section when that costs at most 10%', () => {
    const cell = cellSize(800, 4);
    const fitted = fittedCellSize(width(3, cell * 0.95), 800, 4);

    expect(fitted).toBeCloseTo(cell * 0.95);
    expect(sectionsPerPage(width(3, cell * 0.95), fitted)).toBe(3);
  });

  it('keeps the cell when an extra section would need more than 10% shrink', () => {
    const cell = cellSize(800, 4);

    expect(fittedCellSize(width(3, cell * 0.85), 800, 4)).toBeCloseTo(cell);
  });

  it('keeps the cell when the dashboard has no section to take the room', () => {
    const cell = cellSize(800, 4);

    expect(fittedCellSize(width(3, cell * 0.95), 800, 4, 2)).toBeCloseTo(cell);
    expect(fittedCellSize(width(3, cell * 0.95), 800, 4, 3)).toBeCloseTo(cell * 0.95);
  });
});
