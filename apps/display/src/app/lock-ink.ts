/**
 * The colour of a lock screen widget's type, from the average colour of what lies directly behind it: the inverse of
 * that colour, so it always stands apart, with its hue and saturation kept and only its lightness moved, as little as
 * it takes, until it reads (WCAG contrast of at least 3:1, the floor for large text). Inverting a mid-grey gives a
 * mid-grey, which is the one case where it has to move.
 */

export type Rgb = readonly [number, number, number];

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

/** The type colour for a background of this average colour. */
export function inkOver(average: Rgb, minContrast = MIN_CONTRAST): Rgb {
  const [h, s, l] = toHsl([255 - average[0], 255 - average[1], 255 - average[2]]);
  // On a light background the type goes darker, on a dark one lighter.
  const direction = luminance(average) > 0.179 ? -1 : 1;
  for (let lightness = l; lightness >= 0 && lightness <= 1; lightness += direction * 0.02) {
    const ink = fromHsl(h, s, lightness);
    if (contrast(ink, average) >= minContrast) return ink;
  }
  return direction < 0 ? [0, 0, 0] : [255, 255, 255];
}

export function css([r, g, b]: Rgb, alpha = 1): string {
  return alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}
