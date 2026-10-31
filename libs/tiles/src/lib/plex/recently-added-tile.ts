import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ALL_PLEX_LIBRARIES, PlexItem, plexImageUrl } from '@homey-dash/api-client';
import { TileSize } from '@homey-dash/layout';
import { LucideClapperboard, LucideDynamicIcon } from '@lucide/angular';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';
import { PlexData } from './plex-data';
import { plexIdle } from './now-playing-tile';

/** How many posters fit a tile: one per cell across, two rows on the large sizes. */
export const RECENT_POSTERS: Record<TileSize, number> = { small: 1, wide: 2, full: 3, large: 4, 'full-large': 6 };

/** How many items the detail view lists. */
const DETAIL_COUNT = 24;

/** When something was added, as people say it: Today, Yesterday, 3 days ago, 12 Aug. */
export function addedOn(iso: string, now = Date.now()): string {
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * The posters of what was newly added to one library of the tile's Plex account, or every library of it
 * (`plex-library:all`), newest first: as
 * many as fit the tile, with their titles. A press opens the detail view with the newest 24 and when each was added.
 */
@Component({
  selector: 'hd-plex-recent-tile',
  imports: [TileDetails, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-plex-recent', '[class.has-art]': 'shown().length > 0' },
  template: `
    @if (shown().length) {
      <div class="hd-plex-recent__grid" [attr.data-count]="shown().length">
        @for (item of shown(); track item.id) {
          <div class="hd-plex-recent__item">
            @if (item.image) {
              <img class="hd-plex-recent__poster" [src]="posterUrl(item.image)" alt="" draggable="false" />
            }
            <div class="hd-plex-recent__caption">
              <div class="hd-plex-recent__title">{{ item.title }}</div>
              @if (item.subtitle) {
                <div class="hd-plex-recent__sub">{{ item.subtitle }}</div>
              }
            </div>
          </div>
        }
      </div>
      @if (settings().label) {
        <div class="hd-photo__label">{{ settings().label }}</div>
      }
    } @else {
      <svg class="hd-icon" [lucideIcon]="icon" />
      <div>
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
    <hd-tile-details [name]="face().name" [icon]="icon" subtitle="Newly added">
      <ul class="hd-plex-details__list">
        @for (item of items().slice(0, detailCount); track item.id) {
          <li class="hd-plex-details__row">
            @if (item.image) {
              <img class="hd-plex-details__poster" [src]="posterUrl(item.image)" alt="" draggable="false" />
            }
            <div class="hd-plex-details__info">
              <div class="hd-details__label">{{ item.title }}</div>
              @if (item.subtitle) {
                <div class="hd-plex__sub">{{ item.subtitle }}</div>
              }
              <div class="hd-plex__sub">{{ added(item) }}</div>
            </div>
          </li>
        }
      </ul>
    </hd-tile-details>
  `,
})
export class RecentlyAddedTile extends TileView {
  private readonly plex = inject(PlexData);

  protected readonly icon = LucideClapperboard;
  protected readonly detailCount = DETAIL_COUNT;

  private readonly overview = computed(() => this.plex.overview(this.settings().account));

  private readonly library = computed(() => {
    const target = this.settings().target;
    return this.overview()?.libraries.find((l) => `plex-library:${l.id}` === target);
  });

  /** The target's newest items, merged across libraries for `plex-library:all`. */
  protected readonly items = computed<PlexItem[]>(() => {
    const target = this.settings().target;
    const libraries = this.overview()?.libraries ?? [];
    if (target === ALL_PLEX_LIBRARIES)
      return libraries.flatMap((l) => l.recent).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return this.library()?.recent ?? [];
  });

  protected readonly shown = computed(() => (this.face().state === 'ok' ? this.items().slice(0, RECENT_POSTERS[this.size()]) : []));

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideClapperboard, hue: 'neutral' as const };
    const { target, label } = this.settings();
    const overview = this.overview();
    const status = this.plex.status(this.settings().account);
    const name = label || (target === ALL_PLEX_LIBRARIES ? 'Recently added' : (this.library()?.title ?? 'Plex library'));
    if (!target) return { ...look, name, detail: 'Pick a library', state: 'unset' };
    if (!overview?.loaded) {
      return status && status !== 'connected'
        ? { ...look, name, detail: plexIdle(status, overview?.error), state: 'unavailable' }
        : { ...look, name, detail: '…', state: 'loading' };
    }
    if (target !== ALL_PLEX_LIBRARIES && !this.library()) return { ...look, name, detail: 'Library not found in Plex', state: 'missing' };
    if (!this.items().length) return { ...look, name, detail: 'Nothing added yet', state: 'ok' };
    return { ...look, name, detail: '', details: true, state: 'ok' };
  });

  protected posterUrl(path: string) {
    return plexImageUrl(this.overview()?.accountId ?? 0, path, 400, 600);
  }

  protected added(item: PlexItem) {
    return addedOn(item.addedAt);
  }
}
