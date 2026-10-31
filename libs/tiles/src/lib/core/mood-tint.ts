import { HomeyLightColor } from '@homey-dash/api-client';

/** At most this many of a mood's colours tint its tile or button; more would blur into grey. */
const MAX_TINTS = 3;

/**
 * A gradient of a mood's distinct colours: a colour light's hue, paler as it is less saturated, or a white from cool
 * to warm. Lights of about the same colour count once. Null for a mood that sets no colour.
 */
export function moodTint(colors: readonly HomeyLightColor[]): string | null {
  const tints = new Map<string, string>();
  for (const { hue, saturation, temperature } of colors) {
    if (tints.size === MAX_TINTS) break;
    const s = saturation ?? 1;
    const [key, tint] =
      hue !== null
        ? [`h${Math.round(hue * 12) % 12}`, `hsl(${Math.round(hue * 360)} ${Math.round(s * 100)}% ${Math.round(85 - s * 15)}%)`]
        : temperature !== null
          ? [`w${Math.round(temperature * 2)}`, `color-mix(in oklab, #ffb35c ${Math.round(temperature * 100)}%, #d6e8ff)`]
          : [];
    // The first light of a colour picks its exact shade.
    if (key && tint && !tints.has(key)) tints.set(key, tint);
  }
  const stops = [...tints.values()];
  return stops.length ? `linear-gradient(90deg, ${stops.length > 1 ? stops.join(', ') : `${stops[0]}, ${stops[0]}`})` : null;
}
