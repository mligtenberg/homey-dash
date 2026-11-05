import { backgroundPresetUrl } from '@homey-dash/api-client';
import { BACKGROUND_PALETTES } from './background-presets';

/** A colour scheme: a picked colour, and how many degrees on around the hue wheel the second one is. */
export interface ColorScheme {
  color: string;
  angle: number;
}

/** How vivid ground (sky, floor) and things become at most, as a share of the picked colour's saturation. */
const STRENGTH = { ground: 0.3, thing: 0.65 };

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return '#' + [0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('');
}

/** The scheme's four hues: the picked colour's, the one at the angle from it, and the two opposite those. */
export function schemeHues({ color, angle }: ColorScheme): number[] {
  const [h] = hexToHsl(color);
  return [h, h + angle, h + 180, h + angle + 180].map((hue) => ((hue % 360) + 360) % 360);
}

const distance = (a: string, b: string) =>
  [1, 3, 5].reduce((sum, i) => sum + (parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) ** 2, 0);

/**
 * Redraws a built-in image's SVG in a colour scheme. Each colour takes the hue its nearest palette entry is given
 * (shades and blends of one follow it), at least the vividness that entry's kind allows, and keeps its own lightness, so
 * a day image stays light and a night one dark.
 */
export function recolorSvg(svg: string, style: string, variant: 'day' | 'night', scheme: ColorScheme): string {
  const palette = BACKGROUND_PALETTES[style]?.[variant];
  if (!palette) return svg;
  const hues = schemeHues(scheme);
  const [, saturation] = hexToHsl(scheme.color);
  const mapped = new Map<string, string>();
  return svg.replace(/#[0-9a-f]{6}\b/gi, (found) => {
    const hex = found.toLowerCase();
    let to = mapped.get(hex);
    if (!to) {
      const [, role, ground] = palette.reduce((best, entry) => (distance(hex, entry[0]) < distance(hex, best[0]) ? entry : best));
      const [, s, l] = hexToHsl(hex);
      to = hslToHex(hues[role], Math.max(s, saturation * (ground ? STRENGTH.ground : STRENGTH.thing)), l);
      mapped.set(hex, to);
    }
    return to;
  });
}

const sources = new Map<string, Promise<string>>();
const recolored = new Map<string, Promise<string>>();

/** A built-in image, such as `flat/garden`, by day or by night, redrawn in the scheme, as a data URL. */
export function recoloredPresetUrl(preset: string, variant: 'day' | 'night', scheme: ColorScheme): Promise<string> {
  const key = `${preset}-${variant}-${scheme.color}-${scheme.angle}`;
  let url = recolored.get(key);
  if (!url) {
    const source = backgroundPresetUrl(preset, variant);
    let text = sources.get(source);
    if (!text) {
      text = fetch(source).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${source}: ${r.status}`))));
      text.catch(() => sources.delete(source));
      sources.set(source, text);
    }
    const style = preset.split('/')[0];
    url = text.then((svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(recolorSvg(svg, style, variant, scheme)));
    url.catch(() => recolored.delete(key));
    // Only the latest few stay: every step of the colour wheel makes new ones.
    if (recolored.size >= 64) recolored.delete(recolored.keys().next().value!);
    recolored.set(key, url);
  }
  return url;
}
