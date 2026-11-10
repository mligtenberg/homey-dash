/**
 * The colour of a lock screen widget's type, from what lies directly behind it. It starts as the inverse of the
 * average colour there, taken in OKLab so that it is the perceptual opposite (light for dark, the opposite hue), and is
 * then held to the lightest and the darkest colour in that area (the 95th and 5th percentile, so a lone glint doesn't
 * decide). When either fails to reach the contrast, the colour is worked out again from the inverse of the one that
 * failed, with its lightness moved, as little as it takes, until it reads against both. Where no colour can (an area
 * from mid grey to near black is one: outside it there is no room, and inside it no colour is far enough from both
 * ends), it reads against the average instead, which is most of what lies behind it, and a few of the lightest or
 * darkest spots read less well. Nothing is put behind the type.
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

function linear(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function encode(value: number): number {
  const v = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(255 * Math.min(1, Math.max(0, v)));
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Lab = readonly [number, number, number];

function toOklab([r, g, b]: Rgb): Lab {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// The colour for a lightness and chroma direction, with its chroma taken down until it fits what a screen can show.
function fromOklab([L, a, b]: Lab, scale = 1): { rgb: Rgb; inGamut: boolean } {
  const l = (L + 0.3963377774 * a * scale + 0.2158037573 * b * scale) ** 3;
  const m = (L - 0.1055613458 * a * scale - 0.0638541728 * b * scale) ** 3;
  const s = (L - 0.0894841775 * a * scale - 1.291485548 * b * scale) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const inGamut = [r, g, bl].every((c) => c >= -0.0005 && c <= 1.0005);
  return { rgb: [encode(r), encode(g), encode(bl)], inGamut };
}

function fit(lab: Lab): Rgb {
  if (fromOklab(lab).inGamut) return fromOklab(lab).rgb;
  let [low, high] = [0, 1];
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    if (fromOklab(lab, mid).inGamut) low = mid;
    else high = mid;
  }
  return fromOklab(lab, low).rgb;
}

const inverse = (colour: Rgb): Lab => {
  const [L, a, b] = toOklab(colour);
  return [1 - L, -a, -b];
};

/** How well a colour reads against the worse of the lightest and the darkest colour behind it. */
function worst(ink: Rgb, { lightest, darkest }: Backdrop): number {
  return Math.min(contrast(ink, lightest), contrast(ink, darkest));
}

/** The inverse of `base`, moved lighter or darker, away from `base`, until it reads against the whole backdrop. */
function against(base: Rgb, backdrop: Backdrop, minContrast: number): Rgb | null {
  const [L, a, b] = inverse(base);
  const direction = luminance(base) > 0.179 ? -1 : 1;
  for (let lightness = L; lightness >= 0 && lightness <= 1; lightness += direction * 0.01) {
    const ink = fit([lightness, a, b]);
    if (worst(ink, backdrop) >= minContrast) return ink;
  }
  return null;
}

/** The type colour for this backdrop. */
export function inkOver(backdrop: Backdrop, minContrast = MIN_CONTRAST): Rgb {
  const first = fit(inverse(backdrop.average));
  if (worst(first, backdrop) >= minContrast) return first;
  // The one that fails is what the colour is worked out against again.
  const failing = contrast(first, backdrop.lightest) < contrast(first, backdrop.darkest) ? backdrop.lightest : backdrop.darkest;
  const again = against(failing, backdrop, minContrast);
  if (again) return again;
  // Neither end can be moved away from the other (an area from white to black): the lightness that reads best on both.
  const [, a, b] = inverse(failing);
  let best = first;
  for (let lightness = 0; lightness <= 1; lightness += 0.01) {
    const ink = fit([lightness, a, b]);
    if (worst(ink, backdrop) > worst(best, backdrop)) best = ink;
  }
  if (worst(best, backdrop) >= minContrast) return best;
  // No colour reads on all of it: it reads on most of it.
  const mostly: Backdrop = { average: backdrop.average, lightest: backdrop.average, darkest: backdrop.average };
  return against(backdrop.average, mostly, minContrast) ?? first;
}

export function css([r, g, b]: Rgb): string {
  return `rgb(${r} ${g} ${b})`;
}
