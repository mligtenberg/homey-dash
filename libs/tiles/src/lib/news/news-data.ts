import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { DEFAULT_NEWS_SOURCE, NewsFeed, Realtime } from '@homey-dash/api-client';
import { TileSettings } from '../tile-data';

/** A news tile's settings: which NOS feed it shows (`nos`, the general one, when absent). */
export interface NewsTileSettings extends TileSettings {
  source?: string;
}

/** How long ago, short: `now`, `12 min`, `3 h`, `2 d`. */
export function ago(iso: string | null, now: number): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 60 / 24)} d`;
}

/**
 * The latest stories of every news source in use, from HomeyDash's realtime connection (ADR-0016): a snapshot on every
 * (re)connect, then `News` whenever one changes.
 */
@Injectable({ providedIn: 'root' })
export class NewsData {
  private readonly realtime = inject(Realtime);

  /** Every source's, by id; null until the first snapshot. */
  readonly feeds = signal<NewsFeed[] | null>(null);

  constructor() {
    const stops = [this.realtime.on('News', (feeds) => this.feeds.set(feeds)), this.realtime.whenConnected(() => this.load())];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  }

  /** The feed of a source (the default when none is named); undefined until HomeyDash has read it. */
  feed(source: string | undefined | null): NewsFeed | undefined {
    const id = source || DEFAULT_NEWS_SOURCE;
    return (this.feeds() ?? []).find((f) => f.source === id);
  }

  private async load() {
    try {
      this.feeds.set(await this.realtime.news());
    } catch {
      // The connection dropped again; the next reconnect loads it.
    }
  }
}
