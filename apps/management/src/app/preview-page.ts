import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { DashboardsApi } from '@homey-dash/api-client';
import { fittedCellSize } from '@homey-dash/layout';
import { DashboardView, RealtimeRuleAnswers, TileData } from '@homey-dash/tiles';
import { LucideLayoutDashboard } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { AsDisplayPicker } from './as-display-picker';
import { DisplaysStore } from './displays/displays-store';
import { TranslatePipe } from '@homey-dash/i18n';

/** The strip a display keeps on its left for the dashboard tape and people (the display app's PEOPLE_GUTTER). */
const GUTTER = 68;
/** Room around the drawn screen. */
const MARGIN = 24;

/**
 * The draft rendered the way a display shows it, under a header like the editor's. Seen as on a display that has said
 * its screen size, the draft runs in a frame of exactly that size, scaled to fit: inside it the window is the screen,
 * so a tile's details open over the screen and size themselves to it, as they do on the display. That frame is this
 * page again, with `?as=` the display's id, showing only the dashboard.
 */
@Component({
  selector: 'hd-preview-page',
  imports: [AsDisplayPicker, DashboardView, RouterLink, LucideDynamicIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-app', '[class.is-frame]': 'framed()', '(window:resize)': 'onResize()' },
  template: `
    @if (!framed()) {
      <header #bar class="hd-page__header">
        <ol class="hd-crumbs" [attr.aria-label]="'You are here' | t">
          <li><a routerLink="/dashboards">{{ 'Dashboards' | t }}</a></li>
          <li><a [routerLink]="['/dashboards', id()]">{{ dashboard()?.name ?? 'Dashboard' }}</a></li>
        </ol>
        <span class="hd-mark hd-mark--lg" aria-hidden="true"><svg [lucideIcon]="icon" /></span>
        <h1 class="hd-page__title">{{ 'Preview' | t }}</h1>
        <span class="hd-pill">{{ sizeLabel() }}</span>
        <span class="spacer"></span>
        <hd-as-display-picker />
        <a class="hd-btn hd-btn--primary" [routerLink]="['/dashboards', id()]">{{ 'Back to editor' | t }}</a>
      </header>
    }
    <div class="stage" [class.is-screen]="screen()">
      @if (screen(); as screen) {
        <div class="fit" [style.width.px]="screen.width * scale()" [style.height.px]="screen.height * scale()">
          <iframe
            [src]="frameUrl()"
            [title]="'The draft on ' + display()?.name"
            [style.width.px]="screen.width"
            [style.height.px]="screen.height"
            [style.scale]="scale()"
          ></iframe>
        </div>
      } @else {
        <div class="hd-display screen" [style.--cell.px]="cell()" [style.--dashboard-gutter.px]="gutter()">
          @if (dashboard(); as dashboard) {
            <hd-dashboard-view [layout]="dashboard.draft" />
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100dvh; overflow: hidden; --sec: var(--sec-dashboards); }
    .spacer { flex: 1; }
    .stage { flex: 1; min-height: 0; display: grid; place-items: center; background: var(--ground); overflow: hidden; }
    .screen { position: relative; width: 100%; height: 100%; overflow: hidden; }
    hd-dashboard-view { height: 100%; box-sizing: border-box; }
    iframe { display: block; border: 0; transform-origin: 0 0; background: var(--ground); }
    /* On a display's own screen size: the screen drawn as on a plan, a bezel round it on the sheet. */
    .stage.is-screen { background: var(--chrome); }
    .stage.is-screen .fit { outline: 1.5px solid var(--ink-soft); outline-offset: 6px; border-radius: 2px; }
  `,
})
export class PreviewPage {
  readonly id = input.required<string>();
  /** In the frame: the display the draft is seen as on, which then fills the whole window. */
  readonly as = input<string>();

  private readonly api = inject(DashboardsApi);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly answers = inject(RealtimeRuleAnswers);
  private readonly displays = inject(DisplaysStore);
  private readonly data = inject(TileData);
  private readonly loaded = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.get(params) });
  protected readonly dashboard = this.loaded.value;
  protected readonly icon = LucideLayoutDashboard;
  protected readonly framed = computed(() => !!this.as());

  protected readonly height = signal(window.innerHeight);
  protected readonly width = signal(window.innerWidth);
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');
  private readonly barHeight = signal(0);

  /** The display the draft is seen as on. */
  protected readonly display = computed(() => this.displays.get(this.as() ?? this.answers.seenAs() ?? ''));
  /** Outside the frame: the size of the page on the display's screen, when it has said. */
  protected readonly screen = computed(() => {
    if (this.framed()) return null;
    const d = this.display()?.status.details;
    const width = d?.viewportWidth ?? d?.screenWidth;
    const height = d?.viewportHeight ?? d?.screenHeight;
    return width && height ? { width, height } : null;
  });
  protected readonly scale = computed(() => {
    const screen = this.screen();
    if (!screen) return 1;
    return Math.min(1, (this.width() - 2 * MARGIN) / screen.width, (this.height() - this.barHeight() - 2 * MARGIN) / screen.height);
  });
  protected readonly frameUrl = computed(() => {
    const url = new URL(`dashboards/${encodeURIComponent(this.id())}/preview`, document.baseURI);
    url.searchParams.set('as', this.display()?.id ?? '');
    return this.sanitizer.bypassSecurityTrustResourceUrl(url.href);
  });

  // As the display app does: the tape's gutter when it offers several dashboards, or when people show.
  protected readonly gutter = computed(() => {
    const display = this.display();
    if (!display) return 0;
    const people = (this.data.homeys() ?? []).some((h) => h.users.size > 0);
    return display.dashboardIds.length > 1 || people ? GUTTER : 0;
  });
  protected readonly cell = computed(() => {
    const layout = this.dashboard()?.draft;
    return fittedCellSize(this.width() - this.gutter(), this.height() - this.barHeight(), layout?.rows, layout?.sections.length);
  });
  protected readonly sizeLabel = computed(() => {
    const display = this.display();
    const screen = this.screen();
    if (!display) return 'The draft, fitted to this window';
    if (!screen) return `${display.name} hasn't said its screen size; fitted to this window`;
    const scale = this.scale();
    return `${display.name} · ${screen.width} × ${screen.height}${scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ''}`;
  });

  constructor() {
    // The frame sees rules as on its display, as the page around it does.
    effect(() => {
      const as = this.as();
      if (as) untracked(() => this.answers.seeAs(as));
    });
    afterNextRender(() => this.onResize());
  }

  protected onResize() {
    this.height.set(window.innerHeight);
    this.width.set(window.innerWidth);
    this.barHeight.set(this.bar()?.nativeElement.offsetHeight ?? 0);
  }
}
