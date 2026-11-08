import { DestroyRef, inject, Signal, signal } from '@angular/core';

/**
 * The time now (ms), updated every `ms` while `active` holds, so what depends on it, such as a playbar or "5 min ago",
 * stays true. Stops with the current injection context.
 */
export function clock(ms: number, active: () => boolean = () => true): Signal<number> {
  const now = signal(Date.now());
  const tick = setInterval(() => active() && now.set(Date.now()), ms);
  inject(DestroyRef).onDestroy(() => clearInterval(tick));
  return now.asReadonly();
}

/** The time now, updated as each minute turns, for a clock that shows hours and minutes. */
export function minuteClock(): Signal<Date> {
  const now = signal(new Date());
  let tick: ReturnType<typeof setTimeout>;
  const next = () => {
    const at = new Date();
    now.set(at);
    tick = setTimeout(next, 60_000 - (at.getSeconds() * 1000 + at.getMilliseconds()));
  };
  next();
  inject(DestroyRef).onDestroy(() => clearTimeout(tick));
  return now.asReadonly();
}

/** How long ago an ISO time was, roughly, as of `now` (ms). */
export function timeAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
