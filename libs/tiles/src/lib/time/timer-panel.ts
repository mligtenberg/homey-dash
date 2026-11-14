import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LucideMinus, LucidePause, LucidePlay, LucidePlus, LucideRotateCcw, LucideX } from '@homey-dash/design-system';
import { TranslatePipe } from '@homey-dash/i18n';
import { LucideDynamicIcon } from '@lucide/angular';
import { timerText } from './time-data';
import { TIMER_SOUNDS, TimerDraft, timerLeft, Timers, TimerSound } from './timers';

type Unit = 'hours' | 'minutes' | 'seconds';

const UNITS: readonly { unit: Unit; label: string; max: number; step: number }[] = [
  { unit: 'hours', label: 'Hours', max: 23, step: 1 },
  { unit: 'minutes', label: 'Minutes', max: 59, step: 1 },
  { unit: 'seconds', label: 'Seconds', max: 59, step: 5 },
];

/** What each timer sound is called. */
export const SOUND_LABELS: Record<TimerSound, string> = {
  beep: 'Beep', bell: 'Bell', chime: 'Chime', kitchen: 'Kitchen timer', pulse: 'Pulse', siren: 'Siren', musicbox: 'Music box',
  piano: 'Piano', marimba: 'Marimba', flute: 'Flute', harp: 'Harp',
  ocarina: 'Ocarina lullaby', fanfare: "Hero's fanfare", fairy: 'Fairy harp', treasure: 'Treasure found', village: 'Village dance', none: 'Silent',
};

/**
 * The timer tile's detail view, built like the device views: the dial for a new timer as the hero, the running timers beside it. In it you set a new timer's length, name and sound, and manage the running ones (pause, add a minute, restart, cancel).
 */
@Component({
  selector: 'hd-timer-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LucideDynamicIcon],
  host: { class: 'hd-dev', 'data-mode': 'timer' },
  template: `
    <section class="hd-dev__hero hd-timer-panel__new" [attr.aria-label]="'New timer' | t">
      <div class="hd-timer-panel__dial">
        @for (u of units; track u.unit) {
          <div class="hd-timer-panel__unit">
            <button type="button" class="hd-round-btn" [attr.aria-label]="('More ' + u.label) | t" (click)="step(u, 1)"><svg [lucideIcon]="plus" /></button>
            <span class="hd-dev__big">{{ two(draft()[u.unit]) }}</span>
            <button type="button" class="hd-round-btn" [attr.aria-label]="('Less ' + u.label) | t" (click)="step(u, -1)"><svg [lucideIcon]="minus" /></button>
            <span class="hd-details__label">{{ u.label | t }}</span>
          </div>
        }
      </div>
      <input
        class="hd-timer-panel__name"
        type="text"
        maxlength="30"
        [placeholder]="'Name (optional)' | t"
        [attr.aria-label]="'Name' | t"
        [value]="draft().name"
        (input)="timers.setDraft({ name: $any($event.target).value })"
      />
      <select class="hd-timer-panel__name hd-timer-panel__sound" [attr.aria-label]="'Sound' | t" (change)="timers.setDraft({ sound: $any($event.target).value })">
        @for (option of soundOptions; track option.id) {
          <option [value]="option.id" [selected]="option.id === draft().sound">{{ option.label | t }}</option>
        }
      </select>
      <button type="button" class="hd-timer__stop hd-timer-panel__start" [disabled]="!seconds()" (click)="timers.start()">{{ 'Start' | t }}</button>
    </section>

    <section class="hd-dev__controls" [attr.aria-label]="'Timers' | t">
      @for (timer of rows(); track timer.id) {
        <div class="hd-timer-panel__row" [class.is-done]="timer.done" [class.is-paused]="timer.paused">
          <div class="hd-timer-panel__what">
            <span class="hd-tile__name">{{ timer.title }}</span>
            <span class="hd-value hd-value--m hd-timer-panel__left">{{ timer.text }}</span>
            <span class="hd-progress"><span class="hd-progress__bar" [style.width.%]="timer.percent"></span></span>
          </div>
          <div class="hd-timer-panel__actions">
            @if (timer.done) {
              <button type="button" class="hd-round-btn" [attr.aria-label]="'Start again' | t" (click)="timers.restart(timer.id)"><svg [lucideIcon]="again" /></button>
            } @else {
              <button type="button" class="hd-round-btn" [attr.aria-label]="(timer.paused ? 'Resume' : 'Pause') | t" (click)="timer.paused ? timers.resume(timer.id) : timers.pause(timer.id)">
                <svg [lucideIcon]="timer.paused ? play : pause" />
              </button>
            }
            <button type="button" class="hd-round-btn hd-timer-panel__more" [attr.aria-label]="'Add a minute' | t" (click)="timers.addTime(timer.id, 60)">+1</button>
            <button type="button" class="hd-round-btn" [attr.aria-label]="(timer.done ? 'Stop' : 'Cancel') | t" (click)="timers.remove(timer.id)"><svg [lucideIcon]="x" /></button>
          </div>
        </div>
      } @empty {
        <div class="hd-note">{{ 'No timers' | t }}</div>
      }
    </section>
  `,
})
export class TimerPanel {
  protected readonly timers = inject(Timers);
  protected readonly units = UNITS;
  protected readonly soundOptions = TIMER_SOUNDS.map((id) => ({ id, label: SOUND_LABELS[id] }));
  protected readonly plus = LucidePlus;
  protected readonly minus = LucideMinus;
  protected readonly pause = LucidePause;
  protected readonly play = LucidePlay;
  protected readonly again = LucideRotateCcw;
  protected readonly x = LucideX;

  protected readonly draft = this.timers.draft;
  protected readonly seconds = computed(() => {
    const d = this.draft();
    return d.hours * 3600 + d.minutes * 60 + d.seconds;
  });

  protected readonly rows = computed(() => {
    const now = this.timers.now();
    return this.timers
      .timers()
      .map((t) => {
        const left = timerLeft(t, now);
        return {
          id: t.id,
          title: t.name || timerLength(t.seconds),
          text: timerText(left),
          done: left <= 0,
          paused: t.paused !== undefined,
          percent: Math.min(100, Math.max(0, (left / (t.seconds * 1000)) * 100)),
          left,
        };
      })
      .sort((a, b) => a.left - b.left);
  });

  protected two(n: number) {
    return String(n).padStart(2, '0');
  }

  /** Steps a unit, wrapping at its end so the dial never needs a keyboard. */
  protected step(u: (typeof UNITS)[number], direction: 1 | -1) {
    const size = u.max + 1;
    const value = (((this.draft()[u.unit] + direction * u.step) % size) + size) % size;
    this.timers.setDraft({ [u.unit]: value } as Partial<TimerDraft>);
  }
}

/** A timer's length as the words on it: `5 min`, `1 h 30 min`, `45 s`. */
export function timerLength(seconds: number): string {
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  return [h && `${h} h`, m && `${m} min`, s && `${s} s`].filter(Boolean).join(' ') || '0 s';
}
