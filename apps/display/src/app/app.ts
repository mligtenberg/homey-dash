import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LucideChevronLeft, LucideDynamicIcon, LucideLayers } from '@lucide/angular';
import { IdleRule, Realtime, ScreenView, ShownDashboard } from '@homey-dash/api-client';
import { fittedCellSize } from '@homey-dash/layout';
import { DashboardView, homeyLost, PhotoTile, RuleAnswers, TileData, TileKindRegistry } from '@homey-dash/tiles';
import { screenId, safeStorage } from './screen-id';
import { BRIGHTNESS_MS, LightMeter } from './light-meter';
import { KioskScreen } from './kiosk-screen';
import { LockScreen } from './lock-screen';
import { ScreenSettings } from './screen-settings';
import { ScreenCapture } from './screen-capture';
import { screenDetails } from './screen-details';
import { Setup } from './setup';

type ScreenState = { kind: 'loading' } | { kind: 'setup' } | { kind: 'display'; view: ScreenView };

/**
 * How long a display stays where it is without a touch before it is left alone, and follows its idle rules.
 */
export const IDLE_MS = 60_000;

/**
 * How often, at most, a screen tells HomeyDash it is being touched, for rules on when it was last touched; fine enough
 * for "touched within the last 30 seconds".
 */
export const TOUCH_REPORT_MS = 5_000;

/** How many quick taps in the top-right corner open the screen settings, and how quick. */
export const SETTINGS_TAPS = 5;
export const SETTINGS_TAPS_MS = 3_000;

/** Where a screen remembers that its tape is open. */
const TAPE_KEY = 'homeydash.tape';

/**
 * A screen: setup until it is a display, then its dashboards' published versions, or waiting for one. A display
 * that offers more than one dashboard floats a tape of pills over its left edge to switch between them, which
 * starts collapsed to a single button and collapses again once one is picked. It starts on its first dashboard;
 * left alone, it does what the first idle rule that holds says, and stays where it is while none does. A rule can
 * show a dashboard, or play a photo set or fill the screen with a colour, over the dashboard, until a touch goes back
 * to the rule's dashboard or the one shown before; its lock screen widgets, such as a clock, lie over either.
 */
@Component({
  imports: [DashboardView, LockScreen, LucideDynamicIcon, PhotoTile, ScreenSettings, Setup],
  selector: 'hd-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'hd-display',
    '[class.is-connection-lost]': '!realtime.connected()',
    '[style.--cell.px]': 'cell()',
    '(window:resize)': 'onResize()',
    '(pointerdown)': 'touched()',
    '(keydown)': 'wake()',
    '(wheel)': 'wake()',
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
              <hd-dashboard-view [layout]="dashboard.layout" [class.has-tape]="view.dashboards.length > 1" />
            }
            <!-- Woken on the click rather than the press, so the touch that ends it presses nothing beneath. -->
            @if (slideshow(); as set) {
              <div class="slideshow" role="button" tabindex="0" aria-label="Back to the dashboard" (click)="wake()" animate.leave="is-leaving">
                <hd-photo-tile [settings]="{ target: set.target }" size="full-large" [detailView]="false" [people]="true" />
              </div>
            }
            @if (fill(); as color) {
              <div class="fill" role="button" tabindex="0" aria-label="Back to the dashboard" [style.background]="color" (click)="wake()" animate.leave="is-leaving"></div>
            }
            @if (playing() && !playing()?.screenOff && view.display.lockWidgets.length) {
              <hd-lock-screen [widgets]="view.display.lockWidgets" [class.over-photo]="!!slideshow()" animate.leave="is-leaving" />
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
    <!-- Over everything, so the taps that open the screen settings press nothing beneath. -->
    <span class="corner" aria-hidden="true" (pointerdown)="cornerTap()"></span>
    <hd-screen-settings (cameraChanged)="remeasure()" />
  `,
  styles: `
    :host { display: block; height: 100dvh; overflow: hidden; position: relative; }
    hd-dashboard-view { height: 100%; box-sizing: border-box; }
    /* A gutter for the dashboard tape's toggle, so it floats beside the tiles rather than over them. */
    hd-dashboard-view.has-tape { padding-left: calc(44px + var(--space-3) * 2); }
    .waiting { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-3); text-align: center; padding: var(--space-4); box-sizing: border-box; }
    .waiting h1 { margin: 0; font-size: 32px; font-weight: 800; }
    .waiting p { margin: 0; color: var(--ink-muted); }
    .slideshow, .fill { position: fixed; inset: 0; z-index: 10; background: #000; }
    .is-leaving { pointer-events: none; animation: slideshow-out .5s ease-in-out forwards; }
    @keyframes slideshow-out { to { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .is-leaving { animation: none; } }
    .slideshow hd-photo-tile { width: 100%; height: 100%; border-radius: 0; box-shadow: none; --cell: calc(100dvh / 3); }
    .reconnecting { position: fixed; z-index: 11; left: 50%; bottom: var(--space-5); translate: -50% 0; }
    .corner { position: fixed; z-index: 12; top: 0; right: 0; width: 40px; height: 40px; }
  `,
})
export class App {
  protected readonly realtime = inject(Realtime);
  private readonly kiosk = inject(KioskScreen);
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
      !!this.current()?.layout.sections.some((s) => !s.hidden && s.tiles.some((t) => homeyLost(t, this.kinds.find(t.kind), this.data))),
  );
  protected readonly view = computed(() => {
    const state = this.state();
    return state.kind === 'display' ? state.view : null;
  });

  // Each idle rule's latest answer: undefined until it first arrives, null when HomeyDash refused the rule.
  private readonly heard = signal<(boolean | null | undefined)[]>([]);
  // Compared by value, so joining again with the same rules doesn't subscribe again.
  private readonly idleRules = computed(() => this.view()?.display.idleRules ?? [], {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  // The idle rule that decides; null when none holds, undefined while a rule before the first that holds has not
  // answered yet, or the photo sets have not arrived. A rule that holds is passed over when its dashboard is not
  // offered, or its photo set is gone or has no photos; a colour is always there.
  private readonly idleChoice = computed<IdleRule | null | undefined>(() => {
    const heard = this.heard();
    const offered = new Set(this.view()?.dashboards.map((d) => d.id));
    for (const [i, idle] of this.idleRules().entries()) {
      if (heard[i] === undefined) return undefined;
      if (!heard[i]) continue;
      if (idle.color || idle.screenOff) return idle;
      if (!idle.photoSetId) {
        if (idle.dashboardId && offered.has(idle.dashboardId)) return idle;
      } else if (!this.data.photoSetsLoaded()) return undefined;
      else if (this.photoSet(idle.photoSetId)?.photos.length) return idle;
    }
    return null;
  });
  // The rule whose photo set plays or colour fills the screen, until a touch wakes the display.
  protected readonly playing = signal<IdleRule | null>(null);
  protected readonly slideshow = computed(() => this.photoSet(this.playing()?.photoSetId));
  protected readonly fill = computed(() => this.playing()?.color ?? (this.playing()?.screenOff && !this.kiosk.available ? '#000000' : null));
  // Left alone, it shows what the idle rules choose; touched, it stays on what it shows or on the one picked on the tape.
  private readonly alone = signal(true);
  private readonly shown = signal<string | null>(null);
  // The first stands in for none shown yet, and for one no longer offered.
  protected readonly current = computed(() => {
    const dashboards = this.view()?.dashboards ?? [];
    return dashboards.find((d) => d.id === this.shown()) ?? dashboards[0] ?? null;
  });
  private idle?: ReturnType<typeof setTimeout>;
  private lastReport = -Infinity;
  private readonly lightMeter = inject(LightMeter);
  private readonly destroyRef = inject(DestroyRef);
  private light?: ReturnType<typeof setTimeout>;
  private metering = false;
  private measuring = false;
  private cornerTaps: number[] = [];
  private readonly loadedAt = new Date();
  private resized?: ReturnType<typeof setTimeout>;
  private lightSource: string | null = null;
  private readonly settings = viewChild.required(ScreenSettings);

  private readonly storage = safeStorage();
  protected readonly collapsed = signal(this.storage?.getItem(TAPE_KEY) !== 'open');
  protected readonly showIcon = LucideLayers;
  protected readonly hideIcon = LucideChevronLeft;

  private readonly height = signal(window.innerHeight);
  private readonly width = signal(window.innerWidth);
  protected readonly cell = computed(() => fittedCellSize(this.width(), this.height(), this.current()?.layout.rows));

  constructor() {
    const answers = inject(RuleAnswers);
    // Fully Kiosk Browser turns its screen off while a rule says so, and on again when the rule lets go, a touch ends
    // it, or it sees motion (a touch can't reach a screen that is off).
    this.kiosk.onMotion(() => this.wake());
    effect(() => this.kiosk.setOff(!!this.playing()?.screenOff));
    effect((onCleanup) => {
      const rules = this.idleRules();
      untracked(() => {
        this.heard.set(rules.map(() => undefined));
        const stops = rules.map(({ rule }, i) =>
          answers.subscribe(rule, (holds) => this.heard.update((heard) => heard.map((h, j) => (j === i ? holds : h)))),
        );
        onCleanup(() => stops.forEach((stop) => stop()));
      });
    });
    effect(() => {
      const choice = this.idleChoice();
      if (!this.alone() || !choice) return;
      untracked(() => {
        this.playing.set(choice.photoSetId || choice.color || choice.screenOff ? choice : null);
        if (choice.dashboardId) this.shown.set(choice.dashboardId);
      });
    });
    // Joining again on every reconnect picks up a version published while the connection was lost.
    const stops = [
      this.realtime.on('Screen', (view) => this.show(view)),
      inject(ScreenCapture).answer(),
      this.realtime.whenConnected(() => this.join()),
    ];
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.idle);
      clearTimeout(this.light);
      clearTimeout(this.resized);
      stops.forEach((stop) => stop());
    });
  }

  private photoSet(id: string | null | undefined) {
    return id ? [...this.data.photoSets().values()].find((s) => s.id === id) : undefined;
  }

  // A touch that also ends the slideshow, back on the rule's dashboard, or on the one shown before.
  protected wake() {
    this.touched();
    const playing = this.playing();
    if (!playing) return;
    this.playing.set(null);
    if (playing.returnDashboardId) this.shown.set(playing.returnDashboardId);
  }

  protected select(dashboard: ShownDashboard) {
    this.touched();
    this.shown.set(dashboard.id);
    this.collapse(true);
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

  // Any touch keeps the display where it is; left alone for a while, it follows its idle rules again.
  protected touched() {
    clearTimeout(this.idle);
    this.alone.set(false);
    this.idle = setTimeout(() => this.alone.set(true), IDLE_MS);
    this.reportTouch();
  }

  // The first touch is reported at once; a touch that goes on, once per interval.
  private reportTouch() {
    const now = Date.now();
    if (this.state().kind !== 'display' || !this.realtime.connected() || now - this.lastReport < TOUCH_REPORT_MS) return;
    this.lastReport = now;
    this.realtime.touched().catch(() => undefined);
  }

  // From when it first is a display, a screen measures the light falling on it now and every while after, for rules on
  // its brightness; never during setup, and no more once it has no way to measure or is refused, until a camera is picked.
  private async measureLight() {
    if (this.measuring) return;
    if (this.state().kind === 'display' && this.realtime.connected()) {
      this.measuring = true;
      try {
        const lux = await this.lightMeter.measure();
        if (lux === null) return;
        await this.realtime.brightness(lux);
        // The first reading says whether a sensor or the camera measured it.
        const source = this.lightMeter.reading()?.source ?? null;
        if (source !== this.lightSource) {
          this.lightSource = source;
          this.reportDetails();
        }
      } catch {
        // The camera was busy or the connection dropped; measured again next time.
      } finally {
        this.measuring = false;
      }
    }
    if (!this.destroyRef.destroyed) this.light = setTimeout(() => this.measureLight(), BRIGHTNESS_MS);
  }

  // Measures with the camera just picked at once, rather than at the next measurement.
  protected remeasure() {
    if (!this.lightMeter.available || this.measuring) return;
    clearTimeout(this.light);
    this.metering = true;
    void this.measureLight();
  }

  // Quick taps in the top-right corner, which open the screen settings once there are enough.
  protected cornerTap() {
    const now = Date.now();
    this.cornerTaps = [...this.cornerTaps.filter((at) => now - at < SETTINGS_TAPS_MS), now];
    if (this.cornerTaps.length < SETTINGS_TAPS) return;
    this.cornerTaps = [];
    void this.settings().open();
  }

  // The build the backend ran when this page first connected; a different one on a later connect means an update.
  private build: string | undefined;

  protected async join() {
    try {
      const build = await this.realtime.build();
      if (this.build !== undefined && this.build !== build) return location.reload();
      this.build = build;
      this.show(await this.realtime.joinScreen(this.screenId));
      this.reportDetails();
    } catch {
      // The connection dropped again; joining happens again on reconnect.
    }
  }

  // null: this screen is not (or no longer) a display. The versions are reported once they are in place.
  private show(view: ScreenView | null) {
    this.state.set(view ? { kind: 'display', view } : { kind: 'setup' });
    if (!view) return;
    if (!this.metering && this.lightMeter.available) {
      this.metering = true;
      void this.measureLight();
    }
    const versions = Object.fromEntries(view.dashboards.map((d) => [d.id, d.version]));
    afterNextRender(
      { read: () => void this.realtime.showing(versions).catch(() => undefined) },
      { injector: this.injector },
    );
  }

  // Tells HomeyDash what this screen is; again when its size changes or the light source is known.
  private reportDetails() {
    if (!this.realtime.connected()) return;
    screenDetails(this.kiosk, this.lightMeter, this.loadedAt)
      .then((details) => this.realtime.details(details))
      .catch(() => undefined);
  }

  protected onResize() {
    this.height.set(window.innerHeight);
    this.width.set(window.innerWidth);
    clearTimeout(this.resized);
    this.resized = setTimeout(() => this.reportDetails(), 2_000);
  }
}
