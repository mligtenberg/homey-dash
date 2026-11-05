import { effect, Signal, signal } from '@angular/core';
import { backgroundImageUrl, backgroundPresetUrl, DashboardBackground } from '@homey-dash/api-client';
import { recoloredPresetUrl } from './background-colors';

/** A built-in image's day and night pictures, when not the files the apps ship (such as recoloured ones). */
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

/** The CSS background for a dashboard's background, once a built-in image in a colour scheme has been redrawn in it. */
export async function loadBackgroundStyle(background: DashboardBackground | null | undefined): Promise<string | null> {
  if (background?.kind !== 'preset' || !background.color || background.angle == null) return backgroundStyle(background);
  const scheme = { color: background.color, angle: background.angle };
  const [day, night] = await Promise.all(
    (['day', 'night'] as const).map((variant) => recoloredPresetUrl(background.preset, variant, scheme)),
  );
  return backgroundStyle(background, { day, night });
}

/**
 * `backgroundStyle` as a signal, for a component to bind. A built-in image in a colour scheme shows once redrawn; until
 * then the previous background stays, or the theme's ground at first, rather than flashing its own colours.
 */
export function backgroundSignal(source: () => DashboardBackground | null | undefined): Signal<string | null> {
  const loaded = signal<string | null>(null);
  effect(() => {
    const background = source();
    loadBackgroundStyle(background).then(
      (style) => source() === background && loaded.set(style),
      () => source() === background && loaded.set(backgroundStyle(background)),
    );
  });
  return loaded.asReadonly();
}
