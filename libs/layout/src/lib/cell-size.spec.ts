import { cellSize, sectionsPerPage } from './cell-size';

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
