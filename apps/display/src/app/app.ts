import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { LucideChevronLeft, LucideDynamicIcon, LucideLayers } from '@lucide/angular';
import { Realtime, ScreenView, ShownDashboard } from '@homey-dash/api-client';
import { cellSize } from '@homey-dash/layout';
import { DashboardView, homeyLost, TileData, TileKindRegistry } from '@homey-dash/tiles';
import { screenId, safeStorage } from './screen-id';
import { Setup } from './setup';

type ScreenState = { kind: 'loading' } | { kind: 'setup' } | { kind: 'display'; view: ScreenView };

/** How long a display stays on another dashboard without a touch before it returns to its main one. */
export const IDLE_MS = 60_000;

/** Where a screen remembers that its tape is open. */
const TAPE_KEY = 'homeydash.tape';

/**
 * A screen: setup until it is a display, then its dashboards' published versions, or waiting for one. A display
 * that offers more than one dashboard floats a tape of pills over its left edge to switch between them, which
 * starts collapsed to a single button and collapses again once one is picked.
 */
@Component({
  imports: [DashboardView, LucideDynamicIcon, Setup],
  selector: 'hd-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'hd-display',
    '[class.is-connection-lost]': '!realtime.connected()',
    '[style.--cell.px]': 'cell()',
    '(window:resize)': 'onResize()',
    '(pointerdown)': 'touched()',
    '(keydown)': 'touched()',
    '(wheel)': 'touched()',
  },
  template: `
    @switch (state().kind) {
      @case ('setup') {
        <hd-setup [screenId]="screenId" (done)="join()" />
      }
      @case ('display') {
        @if (view(); as view) {
          @if (current(); as current) {
            @if (view.dashboards.length > 1) {
              <nav class="hd-tape" [class.is-collapsed]="collapsed()" aria-label="Dashboards">
                <button
                  class="hd-tape__toggle"
                  type="button"
                  [attr.aria-label]="collapsed() ? 'Show dashboards' : 'Hide dashboards'"
                  [attr.aria-expanded]="!collapsed()"
                  (click)="toggleTape()"
                >
                  <svg [lucideIcon]="collapsed() ? showIcon : hideIcon" />
                </button>
                @if (!collapsed()) {
                  <div class="hd-tape__pills" [style.--n]="view.dashboards.length" animate.leave="is-leaving">
                    @for (dashboard of view.dashboards; track dashboard.id) {
                      <button
                        class="hd-tape__item"
                        type="button"
                        [style.--i]="$index"
                        [attr.aria-current]="dashboard.id === current.id ? 'page' : null"
                        (click)="select(dashboard)"
                      >
                        {{ dashboard.name }}
                      </button>
                    }
                  </div>
                }
              </nav>
            }
            <!-- One at a time, so switching starts the next dashboard at its first page. -->
            @for (dashboard of [current]; track dashboard.id) {
              <hd-dashboard-view [layout]="dashboard.layout" />
            }
          } @else {
            <div class="waiting">
              <h1>{{ view.display.name }}</h1>
              <span class="hd-pill hd-pill--dot">Waiting for a dashboard</span>
              <p>Assign a dashboard to this display in Management.</p>
            </div>
          }
        }
      }
    }
    @if (lost()) {
      <span class="hd-reconnecting reconnecting" role="status">Reconnecting…</span>
    }
  `,
  styles: `
    :host { display: block; height: 100dvh; overflow: hidden; position: relative; }
    hd-dashboard-view { height: 100%; box-sizing: border-box; }
    .waiting { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-3); text-align: center; padding: var(--space-4); box-sizing: border-box; }
    .waiting h1 { margin: 0; font-size: 32px; font-weight: 800; }
    .waiting p { margin: 0; color: var(--ink-muted); }
    .reconnecting { position: fixed; left: 50%; bottom: var(--space-5); translate: -50% 0; }
  `,
})
export class App {
  protected readonly realtime = inject(Realtime);
  private readonly data = inject(TileData);
  private readonly kinds = inject(TileKindRegistry);
  private readonly injector = inject(Injector);

  protected readonly screenId = screenId();
  // Compared by value, so joining again after a reconnect leaves an unchanged dashboard untouched.
  protected readonly state = signal<ScreenState>({ kind: 'loading' }, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  // Connection lost: HomeyDash cannot be reached, which locks every tile, or HomeyDash cannot reach a Homey the shown
  // dashboard has tiles of (or has no Homey account yet), which locks just those. What is shown stays.
  protected readonly lost = computed(
    () =>
      !this.realtime.connected() ||
      !!this.current()?.layout.sections.some((s) => s.tiles.some((t) => homeyLost(t, this.kinds.find(t.kind), this.data))),
  );
  protected readonly view = computed(() => {
    const state = this.state();
    return state.kind === 'display' ? state.view : null;
  });

  // The dashboard picked on the tape; null is the main one, which also stands in for one no longer offered.
  private readonly picked = signal<string | null>(null);
  protected readonly current = computed(() => {
    const dashboards = this.view()?.dashboards ?? [];
    return dashboards.find((d) => d.id === this.picked()) ?? dashboards[0] ?? null;
  });
  private idle?: ReturnType<typeof setTimeout>;

  private readonly storage = safeStorage();
  protected readonly collapsed = signal(this.storage?.getItem(TAPE_KEY) !== 'open');
  protected readonly showIcon = LucideLayers;
  protected readonly hideIcon = LucideChevronLeft;

  private readonly height = signal(window.innerHeight);
  protected readonly cell = computed(() => cellSize(this.height(), this.current()?.layout.rows));

  constructor() {
    // Joining again on every reconnect picks up a version published while the connection was lost.
    const stops = [this.realtime.on('Screen', (view) => this.show(view)), this.realtime.whenConnected(() => this.join())];
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.idle);
      stops.forEach((stop) => stop());
    });
  }

  protected select(dashboard: ShownDashboard) {
    this.picked.set(dashboard.id === this.view()?.dashboards[0]?.id ? null : dashboard.id);
    this.collapse(true);
    this.touched();
  }

  protected toggleTape() {
    this.collapse(!this.collapsed());
  }

  // Kept on this screen, so an opened tape stays open after a reload.
  private collapse(collapsed: boolean) {
    this.collapsed.set(collapsed);
    if (collapsed) this.storage?.removeItem(TAPE_KEY);
    else this.storage?.setItem(TAPE_KEY, 'open');
  }

  // Any touch keeps the display where it is; left alone on another dashboard, it returns to the main one.
  protected touched() {
    clearTimeout(this.idle);
    if (this.picked() !== null) this.idle = setTimeout(() => this.picked.set(null), IDLE_MS);
  }

  protected async join() {
    try {
      this.show(await this.realtime.joinScreen(this.screenId));
    } catch {
      // The connection dropped again; joining happens again on reconnect.
    }
  }

  // null: this screen is not (or no longer) a display. The versions are reported once they are in place.
  private show(view: ScreenView | null) {
    this.state.set(view ? { kind: 'display', view } : { kind: 'setup' });
    if (!view) return;
    const versions = Object.fromEntries(view.dashboards.map((d) => [d.id, d.version]));
    afterNextRender(
      { read: () => void this.realtime.showing(versions).catch(() => undefined) },
      { injector: this.injector },
    );
  }

  protected onResize() {
    this.height.set(window.innerHeight);
  }
}
