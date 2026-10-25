import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DisplaysApi, ScreenView } from '@homey-dash/api-client';
import { cellSize } from '@homey-dash/layout';
import { DashboardView } from '@homey-dash/tiles';
import { catchError, interval, map, merge, of, startWith, Subject, switchMap } from 'rxjs';
import { screenId } from './screen-id';
import { Setup } from './setup';

// Until realtime arrives, a display asks every few seconds whether its dashboard or assignment changed.
const REFRESH_MS = 10_000;

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
        <hd-setup [screenId]="screenId" (done)="refresh.next()" />
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
  private readonly api = inject(DisplaysApi);

  protected readonly screenId = screenId();
  protected readonly refresh = new Subject<void>();
  // Compared by value, so a poll that finds nothing new leaves the dashboard untouched.
  protected readonly state = signal<ScreenState>({ kind: 'loading' }, {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  protected readonly lost = signal(false);
  protected readonly view = computed(() => {
    const state = this.state();
    return state.kind === 'display' ? state.view : null;
  });

  private readonly height = signal(window.innerHeight);
  protected readonly cell = computed(() => cellSize(this.height(), this.view()?.dashboard?.layout.rows));

  constructor() {
    merge(interval(REFRESH_MS).pipe(startWith(0)), this.refresh)
      .pipe(
        switchMap(() =>
          this.api.screen(this.screenId).pipe(
            map((view): ScreenState => ({ kind: 'display', view })),
            catchError((error: HttpErrorResponse) => of<ScreenState | null>(error.status === 404 ? { kind: 'setup' } : null)),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        // null: HomeyDash could not be reached, so the last known state stays on screen.
        this.lost.set(state === null);
        if (state) this.state.set(state);
      });
  }

  protected onResize() {
    this.height.set(window.innerHeight);
  }
}
