import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LucideTimer } from '@homey-dash/design-system';
import { t, TranslatePipe } from '@homey-dash/i18n';
import { LucideDynamicIcon } from '@lucide/angular';
import { timerLength } from './timer-panel';
import { Timers } from './timers';

/**
 * What a screen shows over everything while timers ring: one card per timer that ran out, side by side on the same
 * screen, each with the timer's name and a button to stop it or give it a minute more. It goes away by itself once
 * the last ringing timer is stopped, restarted or given more time.
 */
@Component({
  selector: 'hd-timer-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LucideDynamicIcon],
  host: { '[class.is-open]': 'ringing().length > 0', role: 'alertdialog', '[attr.aria-label]': 'label' },
  template: `
    @if (ringing().length) {
      <ul class="cards" [style.--n]="ringing().length">
        @for (timer of ringing(); track timer.id) {
          <li class="card">
            <svg class="icon" [lucideIcon]="icon" />
            <span class="title">{{ timer.title }}</span>
            <span class="state">{{ 'Time is up' | t }}</span>
            <div class="actions">
              <button type="button" class="btn btn--main" (click)="timers.remove(timer.id)">{{ 'Stop' | t }}</button>
              <button type="button" class="btn" (click)="timers.addTime(timer.id, 60)">{{ '+1 min' | t }}</button>
            </div>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: none; position: fixed; inset: 0; z-index: 20; align-items: center; justify-content: center; padding: var(--space-4); box-sizing: border-box; background: var(--kind-appliance-fill); color: var(--kind-appliance-ink); animation: pulse 1s ease-in-out infinite alternate; }
    :host(.is-open) { display: flex; }
    @keyframes pulse { to { background: color-mix(in srgb, var(--kind-appliance-fill) 70%, var(--kind-appliance-ink)); } }
    @media (prefers-reduced-motion: reduce) { :host { animation: none; } }
    .cards { list-style: none; margin: 0; padding: 0; width: 100%; height: 100%; display: grid; gap: var(--space-4);
      grid-template-columns: repeat(min(var(--n), 3), 1fr); grid-auto-rows: 1fr; }
    .card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-3); text-align: center; min-width: 0; }
    .icon { width: clamp(48px, 14vmin, 160px); height: auto; aspect-ratio: 1; animation: ring .5s ease-in-out infinite alternate; }
    @keyframes ring { from { rotate: -12deg; } to { rotate: 12deg; } }
    @media (prefers-reduced-motion: reduce) { .icon { animation: none; } }
    .title { font-size: clamp(28px, 9vmin, 120px); font-weight: 800; line-height: 1.1; text-wrap: balance; overflow-wrap: anywhere; }
    .state { font-size: clamp(18px, 4vmin, 48px); opacity: .8; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); justify-content: center; }
    .btn { font: inherit; font-size: clamp(18px, 3.6vmin, 40px); font-weight: 700; min-height: 64px; padding: 0 var(--space-5); border-radius: 999px; border: 3px solid currentColor; background: transparent; color: inherit; cursor: pointer; }
    .btn--main { background: var(--kind-appliance-ink); border-color: var(--kind-appliance-ink); color: var(--kind-appliance-fill); }
    .btn:active { transform: scale(.95); }
  `,
})
export class TimerAlert {
  protected readonly timers = inject(Timers);
  protected readonly icon = LucideTimer;
  protected readonly label = t('Timer is done');

  protected readonly ringing = computed(() => {
    const now = this.timers.now();
    return this.timers
      .timers()
      .filter((timer) => timer.paused === undefined && timer.end <= now)
      .sort((a, b) => a.end - b.end)
      .map((timer) => ({ id: timer.id, title: timer.name || timerLength(timer.seconds) }));
  });
}
