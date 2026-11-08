/** A copy of `list` with the item at `index` moved one place up (-1) or down (+1); unchanged at either end. */
export function moved<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const copy = [...list];
  const to = index + by;
  if (index < 0 || index >= copy.length || to < 0 || to >= copy.length) return copy;
  [copy[index], copy[to]] = [copy[to], copy[index]];
  return copy;
}

/** A copy of `list` without the item at `index`. */
export function removedAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** A copy of `list` with the item at `index` replaced by what `change` makes of it. */
export function changedAt<T>(list: readonly T[], index: number, change: (item: T) => T): T[] {
  return list.map((item, i) => (i === index ? change(item) : item));
}

/** `list` in pieces of `size`, the last one shorter when they don't divide evenly. */
export function chunk<T>(list: readonly T[], size: number): T[][] {
  const pieces: T[][] = [];
  for (let i = 0; i < list.length; i += Math.max(1, size)) pieces.push(list.slice(i, i + Math.max(1, size)));
  return pieces;
}
