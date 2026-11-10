/**
 * The colour of a lock screen widget's type, from what lies directly behind it. It starts as the inverse of the
 * average colour there, so it always stands apart, and is then held to the lightest and the darkest colour in that
 * area, not the average, which a bright patch or a dark one in an otherwise even area would not show. When either fails
 * to reach the contrast, the colour is worked out again from the inverse of the one that failed, with its lightness
 * moved, as little as it takes, until it reads against both.
 */

export type Rgb = readonly [number, number, number];

/** What lies behind a piece of type: its average colour, and the lightest and darkest colour in it. */
export interface Backdrop {
  average: Rgb;
  lightest: Rgb;
  darkest: Rgb;
}

// WCAG's floor for large type.
const MIN_CONTRAST = 3;
// Small type, such as a photo's caption, needs more than large type does.
export const MIN_CONTRAST_SMALL = 4.5;

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === x ? (y - z) / d + (y < z ? 6 : 0) : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

const inverse = ([r, g, b]: Rgb): Rgb => [255 - r, 255 - g, 255 - b];

/** How well a colour reads against the worse of the lightest and the darkest colour behind it. */
function worst(ink: Rgb, { lightest, darkest }: Backdrop): number {
  return Math.min(contrast(ink, lightest), contrast(ink, darkest));
}

/** The inverse of `base`, moved lighter or darker, away from `base`, until it reads against the whole backdrop. */
function against(base: Rgb, backdrop: Backdrop, minContrast: number): Rgb | null {
  const [h, s, l] = toHsl(inverse(base));
  const direction = luminance(base) > 0.179 ? -1 : 1;
  for (let lightness = l; lightness >= 0 && lightness <= 1; lightness += direction * 0.02) {
    const ink = fromHsl(h, s, lightness);
    if (worst(ink, backdrop) >= minContrast) return ink;
  }
  return null;
}

/** The type colour for this backdrop. */
export function inkOver(backdrop: Backdrop, minContrast = MIN_CONTRAST): Rgb {
  const first = inverse(backdrop.average);
  if (worst(first, backdrop) >= minContrast) return first;
  // The one that fails is what the colour is worked out against again.
  const failing = contrast(first, backdrop.lightest) < contrast(first, backdrop.darkest) ? backdrop.lightest : backdrop.darkest;
  const again = against(failing, backdrop, minContrast);
  if (again) return again;
  // Neither end can be moved away from the other (an area from white to black): the lightness that reads best against both.
  const [h, s] = toHsl(inverse(failing));
  let best = first;
  for (let lightness = 0; lightness <= 1; lightness += 0.02) {
    const ink = fromHsl(h, s, lightness);
    if (worst(ink, backdrop) > worst(best, backdrop)) best = ink;
  }
  return best;
}

export function css([r, g, b]: Rgb): string {
  return `rgb(${r} ${g} ${b})`;
}
