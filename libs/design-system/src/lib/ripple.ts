/**
 * Material-style press ripple: a circle that spreads from where a pointer goes down on a pressable `hd-*` surface,
 * clipped to the surface's rounded shape, and fades once the pointer lifts. One listener on the document serves
 * every surface in an app; the look is `.hd-ripple` in components.css.
 */

/** The surfaces that ripple. The innermost wins, so a press on a tile's control ripples the control. */
export const RIPPLE_SURFACES = '.hd-btn, .hd-round-btn, .hd-segmented button, .hd-mood-list__btn, .hd-nav__item, .hd-tape__item, .hd-tape__toggle, .hd-tile[data-tap]';

/** What inside a tile handles its own presses (as `isInline` in libs/tiles does), so the tile does not ripple. */
const TILE_INLINE = 'button, a, input, select, textarea, [role="slider"], dialog';

/** How long the spread and the fade take; `hd-ripple-in` and `.hd-ripple` in components.css match them. */
const SPREAD_MS = 450;
const FADE_MS = 300;

/** The surface a press on `target` ripples, if any. */
export function rippleSurface(target: Element): HTMLElement | null {
  const surface = target.closest<HTMLElement>(RIPPLE_SURFACES);
  if (!surface || surface.matches(':disabled, [aria-disabled="true"]')) return null;
  if (surface.matches('.hd-tile')) {
    const inline = target.closest(TILE_INLINE);
    if (inline && surface.contains(inline)) return null;
  }
  return surface;
}

/** Spreads a ripple on `surface` from the viewport point (`x`, `y`); the returned function fades it away. */
export function startRipple(surface: HTMLElement, x: number, y: number): () => void {
  const box = surface.getBoundingClientRect();
  const left = x - box.left;
  const top = y - box.top;
  // Far enough to reach the farthest corner, so the full circle covers the surface.
  const radius = Math.hypot(Math.max(left, box.width - left), Math.max(top, box.height - top));

  const ripple = surface.ownerDocument.createElement('span');
  ripple.className = 'hd-ripple';
  ripple.setAttribute('aria-hidden', 'true');
  const wave = surface.ownerDocument.createElement('span');
  wave.className = 'hd-ripple__wave';
  // Fractions of the surface, so the ripple keeps to it if the cell size changes mid-press.
  wave.style.left = percent(left, box.width);
  wave.style.top = percent(top, box.height);
  wave.style.width = percent(2 * radius, box.width);
  ripple.append(wave);
  surface.append(ripple);

  const born = Date.now();
  let fading = false;
  return () => {
    if (fading) return;
    fading = true;
    // A quick tap still shows the full spread before it fades.
    setTimeout(() => {
      ripple.classList.add('is-fading');
      setTimeout(() => ripple.remove(), FADE_MS);
    }, Math.max(0, SPREAD_MS - (Date.now() - born)));
  };
}

/** Ripples every pressable surface in `doc`; the returned function stops it. */
export function installRipple(doc: Document = document): () => void {
  const pressed = new Map<number, () => void>();

  const down = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const surface = rippleSurface(event.target);
    if (!surface) return;
    pressed.get(event.pointerId)?.();
    pressed.set(event.pointerId, startRipple(surface, event.clientX, event.clientY));
  };
  // A lift, or the browser taking the pointer over for a scroll or swipe.
  const up = (event: PointerEvent) => {
    pressed.get(event.pointerId)?.();
    pressed.delete(event.pointerId);
  };

  doc.addEventListener('pointerdown', down, { passive: true });
  doc.addEventListener('pointerup', up, { passive: true });
  doc.addEventListener('pointercancel', up, { passive: true });
  return () => {
    doc.removeEventListener('pointerdown', down);
    doc.removeEventListener('pointerup', up);
    doc.removeEventListener('pointercancel', up);
    pressed.forEach((fade) => fade());
    pressed.clear();
  };
}

function percent(part: number, whole: number) {
  return `${whole ? (part / whole) * 100 : 0}%`;
}
