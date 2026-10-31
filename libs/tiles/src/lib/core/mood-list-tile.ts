import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Realtime } from '@homey-dash/api-client';
import { TileSize } from '@homey-dash/layout';
import { LucideSparkles } from '@lucide/angular';
import { moodTint } from './mood-tint';
import { TILE_FACE_HOST, TileFace, TileView } from './tile-view';

/** One of the tile's moods; `found` is false for a mood Homey does not have (any more). */
interface MoodButton {
  id: string;
  name: string;
  found: boolean;
  /** A soft gradient of the mood's colours for the button, or null for a mood without any. */
  tint: string | null;
}

/** How many mood buttons a page of each size holds: columns across, rows down. */
const ONE_ROW = { columns: 2, rows: 2 };
const PAGE: Partial<Record<TileSize, { columns: number; rows: number }>> = {
  wide: ONE_ROW,
  full: { columns: 3, rows: 2 },
  large: { columns: 2, rows: 5 },
  'full-large': { columns: 3, rows: 5 },
};

/**
 * Several moods on one tile, a button each that activates its mood. Moods that do not fit at full size go on further
 * pages, which swipe and snap like the dashboard's, with a dot per page next to the name. A button carries a hint of the
 * colours its mood sets the lights to. The tile is all buttons, so
 * its kind has no detail view. The tile flashes like an action tile, and the detail line names the mood pressed.
 */
@Component({
  selector: 'hd-mood-list-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    ...TILE_FACE_HOST,
    '[class.has-tint]': '!!glow()',
    '[style.--tile-tint]': 'glow()',
  },
  template: `
    <div class="hd-row">
      <div class="hd-tile__name">{{ face().name }}</div>
      @if (face().detail || pages().length < 2) {
        <div class="hd-tile__detail">{{ face().detail }}</div>
      } @else {
        <div class="hd-mood-list__dots">
          @for (page of pages(); track $index) {
            <button
              type="button"
              class="hd-page-dot"
              [attr.aria-label]="'Show moods ' + ($index + 1) + ' of ' + pages().length"
              [attr.aria-current]="$index === current() || null"
              (click)="go($index)"
            ></button>
          }
        </div>
      }
    </div>
    @if (face().state === 'ok') {
      <div #pager class="hd-mood-list" (scroll)="onScroll()">
        @for (page of pages(); track $index) {
          <div class="hd-mood-list__page" [style.--columns]="columns()">
            @for (mood of page; track mood.id) {
              <button
                type="button"
                class="hd-mood-list__btn"
                [class.is-pressed]="pressed() === mood.id && flash()"
                [class.is-tinted]="!!mood.tint"
                [style.--mood-tint]="mood.tint"
                [disabled]="!mood.found"
                [attr.aria-label]="mood.found ? 'Activate ' + mood.name : mood.name + ', not found in Homey'"
                (click)="activate(mood)"
              >
                {{ mood.name }}
              </button>
            }
          </div>
        }
      </div>
    }
  `,
})
export class MoodListTile extends TileView {
  private readonly realtime = inject(Realtime);
  private readonly pager = viewChild<ElementRef<HTMLElement>>('pager');

  /** The mood last pressed, whose name the detail line shows while the tile flashes. */
  protected readonly pressed = signal<string | null>(null);
  protected readonly current = signal(0);

  /** While the tile flashes, the pressed mood's colours, which the whole tile glows in. */
  protected readonly glow = computed(() => (this.flash() === 'ok' ? this.moods().find((m) => m.id === this.pressed())?.tint : null) ?? null);

  private readonly page = computed(() => PAGE[this.size()] ?? ONE_ROW);

  // A single page of fewer moods than fit across still spreads them over the width.
  protected readonly columns = computed(() => Math.max(1, Math.min(this.page().columns, this.moods().length)));

  protected readonly moods = computed<MoodButton[]>(() => {
    const known = this.data.moods();
    return (this.settings().targets ?? []).map((id) => {
      const mood = known.get(id);
      return { id, name: mood?.name ?? 'Not found', found: !!mood, tint: mood ? moodTint(mood.colors) : null };
    });
  });

  protected readonly pages = computed(() => {
    const { columns, rows } = this.page();
    const moods = this.moods();
    const pages: MoodButton[][] = [];
    for (let i = 0; i < moods.length; i += columns * rows) pages.push(moods.slice(i, i + columns * rows));
    return pages;
  });

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideSparkles, hue: 'mood' as const };
    const name = this.settings().label || 'Moods';
    const moods = this.moods();
    if (!moods.length) return { ...look, name, detail: 'Pick moods', state: 'unset' };
    if (!this.data.loaded()) return { ...look, name, detail: '…', state: 'loading' };
    if (!moods.some((m) => m.found)) return { ...look, name, detail: 'Not found in Homey', state: 'missing' };
    const pressed = moods.find((m) => m.id === this.pressed())?.name;
    const flash = this.flash();
    const detail = flash === 'ok' ? `${pressed} activated` : flash === 'error' ? `Could not activate ${pressed}` : '';
    return { ...look, name, detail, state: 'ok' };
  });

  protected activate(mood: MoodButton) {
    this.pressed.set(mood.id);
    this.send(() => this.realtime.activateMood(mood.id), 'early');
  }

  protected onScroll() {
    const pager = this.pager()?.nativeElement;
    if (pager && pager.clientWidth > 0) this.current.set(Math.round(pager.scrollLeft / pager.clientWidth));
  }

  protected go(page: number) {
    const pager = this.pager()?.nativeElement;
    pager?.scrollTo({ left: page * pager.clientWidth, behavior: 'smooth' });
  }
}
