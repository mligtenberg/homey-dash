import { DashboardLayout, Section, Tile } from '@homey-dash/api-client';
import { findPlacementProblems, SECTION_COLUMNS, TILE_SIZES, TilePosition, TileSize } from '@homey-dash/layout';

// Edits to a dashboard's draft. Each returns a new layout, or null when the edit would break the
// layout rules (tiles beyond the grid or overlapping), so the editor can refuse it.

export function newId(): string {
  return crypto.randomUUID();
}

function isValid(layout: DashboardLayout): boolean {
  return layout.sections.every((s) => findPlacementProblems(s.tiles, layout.rows).length === 0);
}

function mapSections(layout: DashboardLayout, update: (s: Section) => Section): DashboardLayout {
  return { ...layout, sections: layout.sections.map(update) };
}

export function findTile(layout: DashboardLayout, tileId: string): { section: Section; tile: Tile } | null {
  for (const section of layout.sections) {
    const tile = section.tiles.find((t) => t.id === tileId);
    if (tile) return { section, tile };
  }
  return null;
}

/** Whether a tile of this size fits at this position, ignoring the tile being moved or resized. */
export function fits(
  layout: DashboardLayout,
  sectionId: string,
  position: TilePosition,
  size: TileSize,
  ignoreTileId?: string,
): boolean {
  const section = layout.sections.find((s) => s.id === sectionId);
  if (!section) return false;
  const others = section.tiles.filter((t) => t.id !== ignoreTileId);
  return findPlacementProblems([...others, { id: '\u0000candidate', position, size }], layout.rows).length === 0;
}

/** The cells of a section that no tile covers, row by row. */
export function emptyCells(layout: DashboardLayout, section: Section): TilePosition[] {
  const cells: TilePosition[] = [];
  for (let row = 0; row < layout.rows; row++) {
    for (let column = 0; column < SECTION_COLUMNS; column++) {
      if (fits(layout, section.id, { column, row }, 'small')) cells.push({ column, row });
    }
  }
  return cells;
}

export function addSection(layout: DashboardLayout, title: string): { layout: DashboardLayout; sectionId: string } {
  const sectionId = newId();
  return { layout: { ...layout, sections: [...layout.sections, { id: sectionId, title, tiles: [] }] }, sectionId };
}

export function renameSection(layout: DashboardLayout, sectionId: string, title: string): DashboardLayout {
  return mapSections(layout, (s) => (s.id === sectionId ? { ...s, title } : s));
}

/** Moves a section one place left (-1) or right (+1). */
export function moveSection(layout: DashboardLayout, sectionId: string, by: -1 | 1): DashboardLayout {
  const sections = [...layout.sections];
  const from = sections.findIndex((s) => s.id === sectionId);
  const to = from + by;
  if (from < 0 || to < 0 || to >= sections.length) return layout;
  [sections[from], sections[to]] = [sections[to], sections[from]];
  return { ...layout, sections };
}

export function removeSection(layout: DashboardLayout, sectionId: string): DashboardLayout {
  return { ...layout, sections: layout.sections.filter((s) => s.id !== sectionId) };
}

/**
 * Adds a tile of a kind at a position, in the first of the kind's sizes that fits there.
 * Null when none fits.
 */
export function addTile(
  layout: DashboardLayout,
  sectionId: string,
  position: TilePosition,
  kind: { id: string; sizes: readonly TileSize[]; defaultSettings: unknown },
): { layout: DashboardLayout; tileId: string } | null {
  const size = kind.sizes.find((s) => fits(layout, sectionId, position, s));
  if (!size) return null;
  const tile: Tile = { id: newId(), kind: kind.id, size, position, settings: structuredClone(kind.defaultSettings) };
  return {
    layout: mapSections(layout, (s) => (s.id === sectionId ? { ...s, tiles: [...s.tiles, tile] } : s)),
    tileId: tile.id,
  };
}

/** Moves a tile to a position, possibly in another section. */
export function moveTile(
  layout: DashboardLayout,
  tileId: string,
  sectionId: string,
  position: TilePosition,
): DashboardLayout | null {
  const found = findTile(layout, tileId);
  if (!found) return null;
  const moved = { ...found.tile, position };
  const next = mapSections(layout, (s) => {
    const tiles = s.tiles.filter((t) => t.id !== tileId);
    return s.id === sectionId ? { ...s, tiles: [...tiles, moved] } : tiles.length === s.tiles.length ? s : { ...s, tiles };
  });
  return next.sections.some((s) => s.id === sectionId) && isValid(next) ? next : null;
}

export function resizeTile(layout: DashboardLayout, tileId: string, size: TileSize): DashboardLayout | null {
  const next = updateTile(layout, tileId, (t) => ({ ...t, size }));
  return isValid(next) ? next : null;
}

export function updateTile(layout: DashboardLayout, tileId: string, update: (t: Tile) => Tile): DashboardLayout {
  return mapSections(layout, (s) =>
    s.tiles.some((t) => t.id === tileId) ? { ...s, tiles: s.tiles.map((t) => (t.id === tileId ? update(t) : t)) } : s,
  );
}

export function removeTile(layout: DashboardLayout, tileId: string): DashboardLayout {
  return mapSections(layout, (s) =>
    s.tiles.some((t) => t.id === tileId) ? { ...s, tiles: s.tiles.filter((t) => t.id !== tileId) } : s,
  );
}

/** Changing the row count is refused when a tile would end up below the last row. */
export function setRows(layout: DashboardLayout, rows: number): DashboardLayout | null {
  const next = { ...layout, rows };
  return rows >= 1 && isValid(next) ? next : null;
}

/**
 * The supported size closest to a span the user dragged out with the resize handle,
 * among those that fit at the tile's position.
 */
export function closestSize(
  layout: DashboardLayout,
  tileId: string,
  sizes: readonly TileSize[],
  wanted: { columns: number; rows: number },
): TileSize | null {
  const found = findTile(layout, tileId);
  if (!found) return null;
  const candidates = sizes.filter((s) => fits(layout, found.section.id, found.tile.position, s, tileId));
  const distance = (s: TileSize) =>
    Math.abs(TILE_SIZES[s].columns - wanted.columns) + Math.abs(TILE_SIZES[s].rows - wanted.rows);
  return candidates.sort((a, b) => distance(a) - distance(b))[0] ?? null;
}
