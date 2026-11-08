import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { clock } from '@homey-dash/design-system';
import { TileSize } from '@homey-dash/layout';
import { ClockTileSettings, digitalTime, handAngles, longDate } from './time-data';

/** The sizes that have room for the date beside or under the time. */
const WITH_DATE: readonly TileSize[] = ['wide', 'full', 'large', 'full-large'];

/** Ticks of an analog clock's dial: twelve, the quarters longer. */
const TICKS = Array.from({ length: 12 }, (_, i) => i);

/**
 * The time, digital or as an analog dial, with the date where the size has room. It points at nothing, so it is never
 * missing or unavailable, and it takes no press.
 */
@Component({
  selector: 'hd-clock-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'hd-tile hd-clock',
    '[attr.data-size]': 'size()',
    '[attr.data-style]': 'style()',
    '[class.has-seconds]': 'settings().seconds',
  },
  template: `
    @if (style() === 'analog') {
      <svg class="hd-clock__dial" viewBox="0 0 100 100" role="img" [attr.aria-label]="time().text + ' ' + time().period">
        <circle class="hd-clock__rim" cx="50" cy="50" r="46" />
        @for (tick of ticks; track tick) {
          <line class="hd-clock__tick" [class.is-quarter]="tick % 3 === 0" x1="50" y1="6" x2="50" [attr.y2]="tick % 3 === 0 ? 14 : 10" [attr.transform]="'rotate(' + tick * 30 + ' 50 50)'" />
        }
        <line class="hd-clock__hand hd-clock__hand--hour" x1="50" y1="50" x2="50" y2="28" [attr.transform]="'rotate(' + angles().hour + ' 50 50)'" />
        <line class="hd-clock__hand hd-clock__hand--minute" x1="50" y1="50" x2="50" y2="14" [attr.transform]="'rotate(' + angles().minute + ' 50 50)'" />
        @if (settings().seconds) {
          <line class="hd-clock__hand hd-clock__hand--second" x1="50" y1="58" x2="50" y2="12" [attr.transform]="'rotate(' + angles().second + ' 50 50)'" />
        }
        <circle class="hd-clock__pin" cx="50" cy="50" r="2.5" />
      </svg>
    } @else {
      <div class="hd-clock__time">
        <span class="hd-clock__digits">{{ time().text }}</span>
        @if (time().period) {
          <span class="hd-unit">{{ time().period }}</span>
        }
      </div>
    }
    @if (showDate()) {
      <div class="hd-clock__date">{{ date() }}</div>
    }
  `,
})
export class ClockTile {
  readonly settings = input.required<ClockTileSettings>();
  readonly size = input.required<TileSize>();

  // Ticks each second; the text only changes as the minute does unless the seconds show.
  private readonly now = clock(1000);

  protected readonly ticks = TICKS;
  protected readonly style = computed(() => this.settings().style ?? 'digital');
  protected readonly at = computed(() => new Date(this.now()));
  protected readonly time = computed(() => digitalTime(this.at(), this.settings()));
  protected readonly angles = computed(() => handAngles(this.at()));
  protected readonly date = computed(() => longDate(this.at()));
  protected readonly showDate = computed(() => this.settings().showDate !== false && WITH_DATE.includes(this.size()));
}
