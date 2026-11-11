import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DisplayInfo } from '@homey-dash/api-client';
import { DisplaysStore } from './displays-store';

export type DisplayHealth = 'ok' | 'stale' | 'none' | 'lost';

/** How a display is doing, in a word and a tone: connected, seen a while ago, never seen, or without a screen. */
export function displayHealth(display: DisplayInfo, store: DisplaysStore): { tone: DisplayHealth; text: string } {
  const status = display.status;
  if (!status.held) return { tone: 'lost', text: 'No screen' };
  if (status.connected) return { tone: 'ok', text: 'Connected' };
  if (!status.lastSeenAt) return { tone: 'none', text: 'Never connected' };
  return { tone: 'stale', text: 'Last seen ' + store.ago(status.lastSeenAt) };
}

/**
 * A display drawn as a screen, as on a plan of the home: a framed outline with the dashboard it starts on inside,
 * how many more it offers, and below it its name and how it is doing.
 */
@Component({
  selector: 'hd-display-sketch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sketch', '[class.is-empty]': '!first()', '[attr.data-tone]': 'health().tone' },
  template: `
    <div class="screen" aria-hidden="true">
      <div class="glass">
        @if (first(); as first) {
          <span class="shows">{{ first }}</span>
          @if (more() > 0) {
            <span class="more">+{{ more() }} more</span>
          }
        } @else {
          <span class="shows">No dashboard</span>
        }
      </div>
    </div>
    <span class="name">{{ display().name }}</span>
    @if (state()) {
      <span class="state"><i></i>{{ health().text }}</span>
    }
    <span class="sr-only">{{ first() ? 'Shows ' + first() + (more() ? ' and ' + more() + ' more' : '') : 'Shows no dashboard yet' }}</span>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .screen {
      width: min(100%, var(--screen-max, 100%)); align-self: center;
      aspect-ratio: 16 / 10; box-sizing: border-box; padding: 6px; margin-bottom: 8px;
      border: 1.5px solid var(--ink-soft); border-radius: 8px; background: var(--panel);
      transition: border-color .15s, translate .2s cubic-bezier(.2, 0, 0, 1);
    }
    .glass {
      height: 100%; box-sizing: border-box; padding: 6px 10px;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; text-align: center;
      border: 1px solid var(--line); border-radius: 3px;
      background: color-mix(in oklab, var(--sec-displays) 9%, var(--panel));
    }
    .shows { font-weight: 600; font-size: 14px; line-height: 1.2; color: var(--sec-dashboards); text-wrap: balance; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .more { font-size: 12px; color: var(--ink-muted); }
    :host(.is-empty) .screen { border-style: dashed; border-color: var(--line-strong); }
    :host(.is-empty) .glass { background: none; border-style: dashed; }
    :host(.is-empty) .shows { color: var(--ink-muted); font-weight: 500; }
    .name { font-weight: 600; overflow-wrap: anywhere; text-wrap: balance; }
    .state { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-muted); }
    .state i { width: 7px; height: 7px; border-radius: 50%; background: var(--line-strong); flex: none; }
    :host([data-tone='ok']) .state { color: var(--ok); }
    :host([data-tone='ok']) .state i { background: var(--ok); }
    :host([data-tone='stale']) .state, :host([data-tone='lost']) .state { color: var(--warn); }
    :host([data-tone='stale']) .state i, :host([data-tone='lost']) .state i { background: var(--warn); }
    :host-context(a:hover) .screen { border-color: var(--sec-displays); translate: 0 -2px; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    @media (prefers-reduced-motion: reduce) { .screen { transition: none; } }
  `,
})
export class DisplaySketch {
  private readonly store = inject(DisplaysStore);
  readonly display = input.required<DisplayInfo>();
  /** False where the full status (versions, Fully Kiosk, light) shows beside it instead. */
  readonly state = input(true);

  protected readonly first = computed(() => {
    const id = this.display().dashboardIds[0];
    return id ? this.store.dashboardName(id) : null;
  });
  protected readonly more = computed(() => Math.max(0, this.display().dashboardIds.length - 1));
  protected readonly health = computed(() => displayHealth(this.display(), this.store));
}
