import { computed, effect, signal, Signal } from '@angular/core';

/**
 * The image to show behind a tile, or null while there is none or once it turned out not to load, so the tile falls back
 * to its plain look with its icon instead of an empty dark backdrop. Call it in an injection context.
 */
export function loadableArt(url: () => string | null | undefined): Signal<string | null> {
  const failed = signal<string | null>(null);
  effect((onCleanup) => {
    const src = url();
    if (!src) return;
    const probe = new Image();
    probe.onerror = () => failed.set(src);
    probe.src = src;
    onCleanup(() => (probe.onerror = null));
  });
  return computed(() => {
    const src = url();
    return src && src !== failed() ? src : null;
  });
}
