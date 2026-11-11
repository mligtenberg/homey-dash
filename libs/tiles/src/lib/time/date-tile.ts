import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { minuteClock } from '@homey-dash/design-system';
import { TileSize } from '@homey-dash/layout';
import { DateTileSettings, monthGrid, weekdayNames, weekNumber } from './time-data';
import { TranslatePipe, formatTag } from '@homey-dash/i18n';

/**
 * Today's date: on small and wide tiles the weekday and the day of the month large; on large tiles the whole month as a
 * calendar with today marked, Monday first. It points at nothing and takes no press.
 */
@Component({
  selector: 'hd-date-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-tile hd-date', '[attr.data-size]': 'size()', '[class.has-month]': 'month()' },
  imports: [TranslatePipe],
  template: `
    @if (month()) {
      <div class="hd-date__head">
        <span class="hd-tile__name">{{ monthName() }}</span>
        <span class="hd-tile__detail">{{ weekdayLong() }}</span>
      </div>
      <table class="hd-date__month" [class.has-weeks]="settings().weekNumbers">
        <thead>
          <tr>
            @if (settings().weekNumbers) {
              <th scope="col" [attr.aria-label]="'Week' | t"></th>
            }
            @for (name of weekdays; track $index) {
              <th scope="col">{{ name }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (week of weeks(); track week.week) {
            <tr>
              @if (settings().weekNumbers) {
                <th scope="row" class="hd-date__week">{{ week.week }}</th>
              }
              @for (day of week.days; track $index) {
                <td [class.is-outside]="!day.inMonth" [class.is-today]="day.today" [attr.aria-current]="day.today ? 'date' : null">{{ day.day }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    } @else {
      <div class="hd-date__weekday">{{ weekdayShortOrLong() }}</div>
      <div class="hd-date__day">
        <span class="hd-value hd-value--l hd-date__number">{{ at().getDate() }}</span>
        <span class="hd-date__month-name">{{ size() === 'small' ? monthShort() : monthName() + ' ' + at().getFullYear() }}</span>
      </div>
      @if (size() !== 'small' && settings().weekNumbers) {
        <div class="hd-tile__detail">Week {{ week() }}</div>
      }
    }
  `,
})
export class DateTile {
  readonly settings = input.required<DateTileSettings>();
  readonly size = input.required<TileSize>();

  // The date only changes at midnight; the minute clock is the cheapest tick that is never late.
  private readonly now = minuteClock();

  protected readonly weekdays = weekdayNames();
  protected readonly at = computed(() => this.now());
  protected readonly month = computed(() => this.size() === 'large' || this.size() === 'full-large');
  protected readonly weeks = computed(() => monthGrid(this.at()));
  protected readonly week = computed(() => weekNumber(this.at()));
  protected readonly monthName = computed(() => this.at().toLocaleDateString(formatTag(), { month: 'long', year: this.month() ? 'numeric' : undefined }));
  protected readonly monthShort = computed(() => this.at().toLocaleDateString(formatTag(), { month: 'short' }));
  protected readonly weekdayLong = computed(() => this.at().toLocaleDateString(formatTag(), { weekday: 'long', day: 'numeric' }));
  protected readonly weekdayShortOrLong = computed(() =>
    this.at().toLocaleDateString(formatTag(), { weekday: this.size() === 'small' ? 'short' : 'long' }),
  );
}
