import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { Realtime, ScreenView } from '@homey-dash/api-client';
import { cellSize } from '@homey-dash/layout';
import { DashboardView, RealtimeTileData } from '@homey-dash/tiles';
import { screenId } from './screen-id';
import { Setup } from './setup';

type ScreenState = { kind: 'loading' } | { kind: 'setup' } | { kind: 'display'; view: ScreenView };

/** A screen: setup until it is a display, then its dashboard's published version, or waiting for one. */
@Component({
  imports: [DashboardView, Setup],
  selector: 'hd-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'hd-display',
    '[class.is-connection-lost]': 'lost()',
    '[style.--cell.px]': 'cell()',
    '(window:resize)': 'onResize()',
  },
  template: `
    @switch (state().kind) {
      @case ('setup') {
        <hd-setup [screenId]="screenId" (done)="join()" />
      }
      @case ('display') {
        @if (view(); as view) {
          @if (view.dashboard; as dashboard) {
            <hd-dashboard-view [layout]="dashboard.layout" />
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
  private readonly realtime = inject(Realtime);
  private readonly homey = inject(RealtimeTileData);

  protected readonly screenId = screenId();
  // Compared by value, so joining again after a reconnect leaves an unchanged dashboard untouched.
  protected readonly state = signal<ScreenState>({ kind: 'loading' }, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  // Connection lost: HomeyDash cannot be reached, or HomeyDash cannot reach Homey. What is shown stays.
  protected readonly lost = computed(
    () => !this.realtime.connected() || this.homey.status()?.connection === 'disconnected',
  );
  protected readonly view = computed(() => {
    const state = this.state();
    return state.kind === 'display' ? state.view : null;
  });

  private readonly height = signal(window.innerHeight);
  protected readonly cell = computed(() => cellSize(this.height(), this.view()?.dashboard?.layout.rows));

  constructor() {
    // Joining again on every reconnect picks up a version published while the connection was lost.
    const stops = [this.realtime.on('Screen', (view) => this.show(view)), this.realtime.whenConnected(() => this.join())];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  }

  protected async join() {
    try {
      this.show(await this.realtime.joinScreen(this.screenId));
    } catch {
      // The connection dropped again; joining happens again on reconnect.
    }
  }

  // null: this screen is not (or no longer) a display.
  private show(view: ScreenView | null) {
    this.state.set(view ? { kind: 'display', view } : { kind: 'setup' });
    if (view) this.realtime.showing(view.dashboard?.version ?? null).catch(() => undefined);
  }

  protected onResize() {
    this.height.set(window.innerHeight);
  }
}
