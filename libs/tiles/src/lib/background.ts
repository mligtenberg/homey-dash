import { backgroundImageUrl, backgroundPresetUrl, DashboardBackground } from '@homey-dash/api-client';

/**
 * The CSS background for a dashboard's background, or null for the theme's own ground. Tiles turn to glass over an
 * image (`hd-has-image`, see `hasImage`), so they stay readable on it. A built-in image is its day one in the light
 * theme and its night one in the dark theme, switching along with it.
 */
export function backgroundStyle(background: DashboardBackground | null | undefined): string | null {
  switch (background?.kind) {
    case 'color':
      return background.color;
    case 'gradient':
      return `linear-gradient(${background.angle}deg, ${background.color}, ${background.to})`;
    case 'image':
      return `center / cover no-repeat url(${backgroundImageUrl(background.imageId)})`;
    case 'preset':
      return (
        'center / cover no-repeat ' +
        `var(--hide-in-dark, url(${backgroundPresetUrl(background.preset, 'day')})) ` +
        `var(--hide-in-light, url(${backgroundPresetUrl(background.preset, 'night')}))`
      );
    default:
      return null;
  }
}

/** Whether the background is a picture, uploaded or built in, that tiles turn to glass over. */
export function hasImage(background: DashboardBackground | null | undefined): boolean {
  return background?.kind === 'image' || background?.kind === 'preset';
}
