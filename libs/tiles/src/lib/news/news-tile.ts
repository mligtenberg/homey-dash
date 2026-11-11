import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DEFAULT_NEWS_SOURCE } from '@homey-dash/api-client';
import { LucideNewspaper, minuteClock } from '@homey-dash/design-system';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';
import { NewsBrowser } from './news-browser';
import { NosLogo } from './nos-logo';
import { ago, NewsData, NewsTileSettings } from './news-data';
import { TranslatePipe } from '@homey-dash/i18n';

/** How many headlines each size has room for. */
const HEADLINES = { small: 1, wide: 1, full: 2, large: 3, 'full-large': 6 } as const;

/**
 * The latest headlines of a NOS feed (ADR-0016): the newest on small and wide, more as the size allows, each with how long
 * ago it came out. A press opens the whole of NOS over the screen: its feeds, videos and livestreams (`NewsBrowser`).
 */
@Component({
  selector: 'hd-news-tile',
  imports: [NewsBrowser, NosLogo, TileDetails, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-news' },
  template: `
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
        <div class="hd-tile__detail">{{ face().detail | t }}</div>
      </div>
    }
    <div class="hd-tile__name hd-news__source"><hd-nos-logo /><span>{{ shortName() }}</span></div>

    <hd-tile-details [screen]="true" [name]="shortName()" [icon]="face().icon">
      <hd-nos-logo hdDetailsMark />
      <hd-news-browser [source]="sourceId()" />
    </hd-tile-details>
  `,
})
export class NewsTile extends TileView<NewsTileSettings> {
  private readonly news = inject(NewsData);
  private readonly now = minuteClock();

  /** The feed the tile shows, and the tab its detail view opens on. */
  protected readonly sourceId = computed(() => this.settings().source ?? DEFAULT_NEWS_SOURCE);

  protected readonly feed = computed(() => this.news.feed(this.settings().source));

  protected readonly headlines = computed(() => {
    const now = this.now().getTime();
    return (this.feed()?.items ?? []).slice(0, HEADLINES[this.size() as keyof typeof HEADLINES] ?? 1).map((i) => ({ title: i.title, age: ago(i.publishedAt, now) }));
  });

  /** The feed's name without the NOS in front, which the logo says: `Nieuws`, `Sport`. */
  protected readonly shortName = computed(() => this.face().name.replace(/^NOS\s+/, '') || this.face().name);

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideNewspaper, hue: 'mood' as const };
    const feed = this.feed();
    const name = this.settings().label || feed?.name || 'News';
    if (this.headlines().length) {
      return { ...look, name, detail: '', details: true, state: feed?.status === 'disconnected' ? 'unavailable' : 'ok' };
    }
    if (!this.news.feeds() || !feed || feed.status === 'loading') return { ...look, name, detail: '…', state: 'loading' };
    return { ...look, name, detail: feed.error ?? 'No news', state: 'unavailable' };
  });
}
