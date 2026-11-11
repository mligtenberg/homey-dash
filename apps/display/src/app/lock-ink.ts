/**
 * The colours of the lock screen's type. The type is cut out of the picture's inverse (see `inverseOf`, in OKLab: as
 * light as the original is dark, in the opposite hue), with white or black over it as a base, whichever reads better
 * against the average colour directly behind the type.
 */

export type Rgb = readonly [number, number, number];

/** What lies behind a piece of type: its average colour, and the lightest and darkest colour in it. */
export interface Backdrop {
  average: Rgb;
  lightest: Rgb;
  darkest: Rgb;
}

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

// A plain inverse turns a middle tone into the same middle tone, which reads on nothing. So the lightness is pushed away
// from the point where white and black type read equally well (OKLab 0.57), and kept at least GAP from the colour it is
// over, on the dark side for what is lighter than that point and the light side for what is darker.
const PIVOT = 0.57;
const PUSH = 1.8;
const GAP = 0.4;

const inverse = (colour: Rgb): Lab => {
  const [L, a, b] = toOklab(colour);
  const pushed = PIVOT + (PIVOT - L) * PUSH;
  const apart = L >= PIVOT ? Math.min(pushed, L - GAP) : Math.max(pushed, L + GAP);
  return [Math.min(1, Math.max(0, apart)), -a, -b];
};

/**
 * The inverse of a colour in OKLab: light for dark, in the opposite hue, with the lightness pushed away from the middle.
 * The lightness may come from another version of the picture than the hue does (`near`, less blurred), so that
 * what is light and what is dark follows the picture closely while the colour changes slowly.
 */
export function inverseOf(colour: Rgb, near: Rgb = colour): Rgb {
  const [, a, b] = inverse(colour);
  return fit([inverse(near)[0], a, b]);
}

/** White or black, whichever reads better against what lies behind the type. */
export function inkOver({ average }: Backdrop): Rgb {
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];
  return contrast(white, average) >= contrast(black, average) ? white : black;
}

export function css([r, g, b]: Rgb): string {
  return `rgb(${r} ${g} ${b})`;
}

/**
 * The most prominent colour among the pixels of an image under some rectangles (in the image's own pixels): colours are
 * grouped 4 bits to a channel, and the group with the most pixels wins, as the average of the pixels in it. Null when
 * the rectangles cover none of the image.
 */
export function prominentColour(data: Uint8ClampedArray, width: number, height: number, rects: readonly DOMRectReadOnly[]): Rgb | null {
  const groups = new Map<number, { count: number; sum: [number, number, number] }>();
  const seen = new Uint8Array(width * height);
  for (const rect of rects) {
    const x0 = Math.max(0, Math.floor(rect.left));
    const x1 = Math.min(width, Math.ceil(rect.right));
    const y0 = Math.max(0, Math.floor(rect.top));
    const y1 = Math.min(height, Math.ceil(rect.bottom));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        // Overlapping rectangles count a pixel once.
        if (seen[y * width + x]) continue;
        seen[y * width + x] = 1;
        const i = (y * width + x) * 4;
        const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        const group = groups.get(key) ?? { count: 0, sum: [0, 0, 0] };
        group.count++;
        for (let c = 0; c < 3; c++) group.sum[c] += data[i + c];
        groups.set(key, group);
      }
    }
  }
  let best: { count: number; sum: [number, number, number] } | null = null;
  for (const group of groups.values()) if (!best || group.count > best.count) best = group;
  return best ? [Math.round(best.sum[0] / best.count), Math.round(best.sum[1] / best.count), Math.round(best.sum[2] / best.count)] : null;
}
