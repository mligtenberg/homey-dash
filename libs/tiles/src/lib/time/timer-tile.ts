import { ChangeDetectionStrategy, Component, computed, inject, input, viewChild } from '@angular/core';
import { LucideTimer, LucideX } from '@homey-dash/design-system';
import { TileSize } from '@homey-dash/layout';
import { t, TranslatePipe } from '@homey-dash/i18n';
import { LucideDynamicIcon } from '@lucide/angular';
import { DEFAULT_TIMER_MINUTES, TimerTileSettings, timerText } from './time-data';
import { TileDetails } from '../core/tile-details';
import { TimerPanel, timerLength } from './timer-panel';
import { timerLeft, Timers } from './timers';

/** How many timers besides the first a size lists; wide and full have room for the first only. */
const QUEUE: Partial<Record<TileSize, number>> = { large: 2, 'full-large': 4 };

/**
 * Timers. The one that ends first is the hero, read across the room; the others queue under it where the size has room.
 * Buttons start a timer of their length. A timer that runs out rings: the tile fills with its hue and the timer's reading
 * flashes until it is dismissed. The timers belong to the screen, so every timer tile on it shows the same ones.
 */
@Component({
  selector: 'hd-timer-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LucideDynamicIcon, TileDetails, TimerPanel],
  host: {
    class: 'hd-tile hd-timer',
    'data-kind': 'appliance',
    '[attr.data-size]': 'size()',
    '[class.is-active]': 'ringing()',
    'data-tap': '',
    role: 'button',
    tabindex: '0',
    '(click)': 'onPress($event)',
    '(keydown.enter)': 'onKey($event)',
    '(keydown.space)': 'onKey($event)',
  },
  template: `
    <div class="hd-timer__main">
      @if (first(); as timer) {
        <div class="hd-timer__head">
          <div class="hd-timer__name">
            <span class="hd-tile__name">{{ timer.title }}</span>
          </div>
          @if (timer.left <= 0) {
            <button type="button" class="hd-timer__stop" (click)="timers.remove(timer.id)">{{ 'Stop' | t }}</button>
          } @else {
            <button type="button" class="hd-round-btn" [attr.aria-label]="'Cancel' | t" (click)="timers.remove(timer.id)">
              <svg class="hd-timer__x" [lucideIcon]="x" />
            </button>
          }
        </div>
        <span class="hd-value hd-timer__digits" [class.is-done]="timer.left <= 0" [class.is-paused]="timer.paused">{{ timer.text }}</span>
        <span class="hd-progress"><span class="hd-progress__bar" [style.width.%]="timer.percent"></span></span>
        @if (more() > 0) {
          <span class="hd-tile__detail hd-timer__others">{{ '+{count} others' | t: { count: more() } }}</span>
        }
      } @else {
        <svg class="hd-icon hd-timer__icon" [lucideIcon]="icon" />
        <div>
          <div class="hd-tile__name">{{ 'Timer' | t }}</div>
          <div class="hd-tile__detail">{{ 'No timers' | t }}</div>
        </div>
      }
    </div>
    @if (queue().length) {
      <ul class="hd-timer__queue">
        @for (timer of queue(); track timer.id) {
          <li [class.is-done]="timer.left <= 0">
            <span class="hd-timer__qtime">{{ timer.text }}</span>
            <span class="hd-tile__detail">{{ timer.title }}</span>
            <button type="button" class="hd-round-btn" [attr.aria-label]="(timer.left <= 0 ? 'Stop' : 'Cancel') | t" (click)="timers.remove(timer.id)">
              <svg class="hd-timer__x" [lucideIcon]="x" />
            </button>
          </li>
        }
      </ul>
    }
    <hd-tile-details [screen]="true" [name]="'Timers'" [icon]="icon" [subtitle]="subtitle()">
      <hd-timer-panel />
    </hd-tile-details>
    <div class="hd-timer__add" role="group" [attr.aria-label]="'Start a timer' | t">
      @for (m of minutes(); track m) {
        <button type="button" class="hd-timer__preset" (click)="timers.add(m * 60)" [attr.aria-label]="m + ' ' + ('min' | t)">{{ m }}<span class="hd-unit">{{ 'min' | t }}</span></button>
      }
    </div>
  `,
})
export class TimerTile {
  readonly settings = input.required<TimerTileSettings>();
  readonly size = input.required<TileSize>();

  protected readonly timers = inject(Timers);
  private readonly details = viewChild.required(TileDetails);
  protected readonly icon = LucideTimer;
  protected readonly x = LucideX;

  protected readonly minutes = computed(() => {
    const own = this.settings().minutes?.filter((m) => m > 0);
    return own?.length ? own : DEFAULT_TIMER_MINUTES;
  });
  private readonly all = computed(() => {
    const now = this.timers.now();
    return this.timers
      .timers()
      .map((t) => {
        const left = timerLeft(t, now);
        return {
          id: t.id,
          left,
          text: timerText(left),
          title: t.name || timerLength(t.seconds),
          paused: t.paused !== undefined,
          percent: Math.min(100, Math.max(0, (left / (t.seconds * 1000)) * 100)),
        };
      })
      // The one that ends first, or has already, leads.
      .sort((a, b) => a.left - b.left);
  });
  protected readonly first = computed(() => this.all()[0]);
  protected readonly queue = computed(() => this.all().slice(1, 1 + (QUEUE[this.size()] ?? 0)));
  /** The timers the tile has no room to list, shown as a count beside the first. */
  protected readonly more = computed(() => Math.max(0, this.all().length - 1 - this.queue().length));
  protected readonly ringing = computed(() => this.all().some((t) => t.left <= 0));

  protected readonly subtitle = computed(() => {
    const n = this.all().length;
    return n === 0 ? t('No timers') : t('{count} timers', { count: n });
  });

  protected onPress(event: Event) {
    // The buttons on the tile start and stop timers themselves; any other press opens the modal.
    if (!(event.target as Element).closest('button, dialog')) this.details().open();
  }

  protected onKey(event: Event) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.onPress(event);
  }
}
