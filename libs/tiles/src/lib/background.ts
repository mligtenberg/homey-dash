import { backgroundImageUrl, backgroundPresetUrl, DashboardBackground, renderedPresetUrl } from '@homey-dash/api-client';

/** A built-in image's day and night pictures, when not the SVGs the apps ship (such as rendered ones). */
export interface PresetUrls {
  day: string;
  night: string;
}

/**
 * The CSS background for a dashboard's background, or null for the theme's own ground. Tiles turn to glass over an
 * image (`hd-has-image`, see `hasImage`), so they stay readable on it. A built-in image is its day one in the light
 * theme and its night one in the dark theme, switching along with it; `urls` stand in for its files.
 */
export function backgroundStyle(background: DashboardBackground | null | undefined, urls?: PresetUrls): string | null {
  switch (background?.kind) {
    case 'color':
      return background.color;
    case 'gradient':
      return `linear-gradient(${background.angle}deg, ${background.color}, ${background.to})`;
    case 'image':
      return `center / cover no-repeat url(${backgroundImageUrl(background.imageId)})`;
    case 'preset': {
      const { day, night } = urls ?? {
        day: backgroundPresetUrl(background.preset, 'day'),
        night: backgroundPresetUrl(background.preset, 'night'),
      };
      return `center / cover no-repeat var(--hide-in-dark, url("${day}")) var(--hide-in-light, url("${night}"))`;
    }
    default:
      return null;
  }
}

/** Whether the background is a picture, uploaded or built in, that tiles turn to glass over. */
export function hasImage(background: DashboardBackground | null | undefined): boolean {
  return background?.kind === 'image' || background?.kind === 'preset';
}

/**
 * `backgroundStyle` with a built-in image rendered by HomeyDash for width × height CSS pixels at the screen's pixel
 * density (rounded up, so slightly different sizes share an image), in its colour scheme.
 */
export function renderedBackgroundStyle(
  background: DashboardBackground | null | undefined,
  width: number,
  height: number,
  density = globalThis.devicePixelRatio || 1,
): string | null {
  if (background?.kind !== 'preset') return backgroundStyle(background);
  const side = (css: number) => Math.min(4096, Math.max(16, Math.ceil((css * density) / 16) * 16));
  const [w, h] = [side(width), side(height)];
  return backgroundStyle(background, {
    day: renderedPresetUrl(background, 'day', w, h),
    night: renderedPresetUrl(background, 'night', w, h),
  });
}
