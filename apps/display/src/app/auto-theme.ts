export type Theme = 'light' | 'dark';

// A room goes dark below this many lux and light again above the higher one, so a reading near the line, which a
// camera estimate often is, doesn't flip the screen back and forth. A lit room is far above both, a night room far below.
export const DARK_BELOW_LX = 15;
export const LIGHT_ABOVE_LX = 50;

/** The theme for a room's lux, staying as it is while the lux is between the two lines. */
export function themeFor(lux: number, current: Theme | null): Theme {
  if (lux < DARK_BELOW_LX) return 'dark';
  if (lux > LIGHT_ABOVE_LX) return 'light';
  return current ?? 'light';
}
