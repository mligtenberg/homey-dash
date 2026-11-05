import { backgroundPresetUrl } from '@homey-dash/api-client';

/** A colour scheme: a picked colour, and how many degrees on around the (oklch) hue wheel the second one is. */
export interface ColorScheme {
  color: string;
  angle: number;
}

/** How light colours on the scheme wheel are drawn and saved, and the most chroma it offers. */
export const SCHEME_LIGHTNESS = 0.7;
export const SCHEME_MAX_CHROMA = 0.2;

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** A `#rrggbb` colour as oklch: lightness (0–1), chroma and hue (degrees). */
export function hexToOklch(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

function oklchToRgb(L: number, C: number, H: number): number[] {
  const [A, B] = [C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLinear);
}

/** An oklch colour as `#rrggbb`, with its chroma lowered until it fits, so it keeps its hue and lightness. */
export function oklchToHex(L: number, C: number, H: number): string {
  const fits = (c: number) => oklchToRgb(L, c, H).every((v) => v >= -0.0005 && v <= 1.0005);
  let [low, high] = [0, C];
  if (!fits(C)) for (let i = 0; i < 20; i++) [low, high] = fits((low + high) / 2) ? [(low + high) / 2, high] : [low, (low + high) / 2];
  const rgb = oklchToRgb(L, fits(C) ? C : low, H);
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * The CSS custom properties a built-in image is recoloured by (see libs/design-system/backgrounds/generate.mjs): the
 * picked colour's oklch hue and chroma, and the angle to the second colour.
 */
export function schemeProperties({ color, angle }: ColorScheme) {
  const [, chroma, hue] = hexToOklch(color);
  return { '--scheme-hue': +hue.toFixed(1), '--scheme-angle': angle, '--scheme-chroma': +chroma.toFixed(3) };
}

/** A built-in image's SVG with the scheme written into it, so it shows recoloured wherever it is an image. */
export function bakeScheme(svg: string, scheme: ColorScheme): string {
  const properties = Object.entries(schemeProperties(scheme)).map(([name, value]) => `${name}:${value}`).join(';');
  return svg.replace(/^(<svg[^>]*>)/, `$1<style>svg{${properties}}</style>`);
}

const sources = new Map<string, Promise<string>>();

/** A built-in image's SVG, such as `flat/garden` by day, fetched once. */
export function presetSvg(preset: string, variant: 'day' | 'night'): Promise<string> {
  const url = backgroundPresetUrl(preset, variant);
  let text = sources.get(url);
  if (!text) {
    text = fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${url}: ${r.status}`))));
    text.catch(() => sources.delete(url));
    sources.set(url, text);
  }
  return text;
}

/** A built-in image, by day or by night, pre-rendered in the scheme, as a data URL. */
export async function schemedPresetUrl(preset: string, variant: 'day' | 'night', scheme: ColorScheme): Promise<string> {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(bakeScheme(await presetSvg(preset, variant), scheme));
}
