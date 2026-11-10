import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LucideNewspaper, minuteClock } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';
import { ago, NewsData, NewsTileSettings } from './news-data';

/** How many headlines each size has room for. */
const HEADLINES = { small: 1, wide: 1, full: 2, large: 4, 'full-large': 6 } as const;

/**
 * The latest headlines of a NOS feed (ADR-0016): the newest on small and wide, more as the size allows, each with how long
 * ago it came out. A press does nothing; the screen is for glancing.
 */
@Component({
  selector: 'hd-news-tile',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-news' },
  template: `
    <div class="hd-row hd-row--top">
      <svg class="hd-icon" [lucideIcon]="face().icon" aria-hidden="true" />
    </div>
    @if (headlines().length) {
      <ol class="hd-news__list">
        @for (item of headlines(); track item.title) {
          <li class="hd-news__item">
            <span class="hd-news__title">{{ item.title }}</span>
            <span class="hd-news__age">{{ item.age }}</span>
          </li>
        }
      </ol>
    } @else {
      <div class="hd-news__list">
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
    <div class="hd-tile__name">{{ face().name }}</div>
  `,
})
export class NewsTile extends TileView<NewsTileSettings> {
  private readonly news = inject(NewsData);
  private readonly now = minuteClock();

  protected readonly feed = computed(() => this.news.feed(this.settings().source));

  protected readonly headlines = computed(() => {
    const now = this.now().getTime();
    return (this.feed()?.items ?? []).slice(0, HEADLINES[this.size() as keyof typeof HEADLINES] ?? 1).map((i) => ({ title: i.title, age: ago(i.publishedAt, now) }));
  });

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideNewspaper, hue: 'mood' as const };
    const feed = this.feed();
    const name = this.settings().label || feed?.name || 'News';
    if (this.headlines().length) {
      return { ...look, name, detail: '', state: feed?.status === 'disconnected' ? 'unavailable' : 'ok' };
    }
    if (!this.news.feeds() || !feed || feed.status === 'loading') return { ...look, name, detail: '…', state: 'loading' };
    return { ...look, name, detail: feed.error ?? 'No news', state: 'unavailable' };
  });
}
