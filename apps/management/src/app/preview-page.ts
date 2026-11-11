import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { DashboardsApi } from '@homey-dash/api-client';
import { fittedCellSize } from '@homey-dash/layout';
import { DashboardView, RealtimeRuleAnswers, TileData } from '@homey-dash/tiles';
import { LucideLayoutDashboard } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { AsDisplayPicker } from './as-display-picker';
import { DisplaysStore } from './displays/displays-store';

/** The strip a display keeps on its left for the dashboard tape and people (the display app's PEOPLE_GUTTER). */
const GUTTER = 68;
/** Room around the drawn screen. */
const MARGIN = 24;

/** The draft rendered the way a display shows it, under a header like the editor's, fitted to the rest of the window. */
@Component({
  selector: 'hd-preview-page',
  imports: [AsDisplayPicker, DashboardView, RouterLink, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-app', '(window:resize)': 'onResize()' },
  template: `
    <header #bar class="hd-page__header">
      <ol class="hd-crumbs" aria-label="You are here">
        <li><a routerLink="/dashboards">Dashboards</a></li>
        <li><a [routerLink]="['/dashboards', id()]">{{ dashboard()?.name ?? 'Dashboard' }}</a></li>
      </ol>
      <span class="hd-mark hd-mark--lg" aria-hidden="true"><svg [lucideIcon]="icon" /></span>
      <h1 class="hd-page__title">Preview</h1>
      <span class="hd-pill">{{ sizeLabel() }}</span>
      <span class="spacer"></span>
      <hd-as-display-picker />
      <a class="hd-btn hd-btn--primary" [routerLink]="['/dashboards', id()]">Back to editor</a>
    </header>
    <div class="stage" [class.is-screen]="screen()">
      <div class="fit" [style.width.px]="frame().width * frame().scale" [style.height.px]="frame().height * frame().scale">
        <div
          class="hd-display screen"
          [style.width.px]="frame().width"
          [style.height.px]="frame().height"
          [style.scale]="frame().scale"
          [style.--cell.px]="cell()"
          [style.--dashboard-gutter.px]="gutter()"
        >
          @if (dashboard(); as dashboard) {
            <hd-dashboard-view [layout]="dashboard.draft" />
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100dvh; overflow: hidden; --sec: var(--sec-dashboards); }
    .spacer { flex: 1; }
    .stage { flex: 1; min-height: 0; display: grid; place-items: center; background: var(--ground); overflow: hidden; }
    .screen { position: relative; transform-origin: 0 0; overflow: hidden; }
    hd-dashboard-view { height: 100%; box-sizing: border-box; }
    /* On a display's own screen size: the screen drawn as on a plan, a bezel round it on the sheet. */
    .stage.is-screen { background: var(--chrome); }
    .stage.is-screen .fit { outline: 1.5px solid var(--ink-soft); outline-offset: 6px; border-radius: 2px; }
  `,
})
export class PreviewPage {
  readonly id = input.required<string>();

  private readonly api = inject(DashboardsApi);
  private readonly loaded = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.get(params) });
  protected readonly dashboard = this.loaded.value;
  protected readonly height = signal(window.innerHeight);
  protected readonly width = signal(window.innerWidth);
  protected readonly icon = LucideLayoutDashboard;
  private readonly bar = viewChild.required<ElementRef<HTMLElement>>('bar');
  private readonly barHeight = signal(0);
  private readonly answers = inject(RealtimeRuleAnswers);
  private readonly displays = inject(DisplaysStore);
  private readonly data = inject(TileData);

  /** The display picked to see the draft as on, when it has said how large the page on its screen is. */
  private readonly display = computed(() => this.displays.get(this.answers.seenAs() ?? ''));
  protected readonly screen = computed(() => {
    const d = this.display()?.status.details;
    const width = d?.viewportWidth ?? d?.screenWidth;
    const height = d?.viewportHeight ?? d?.screenHeight;
    return width && height ? { width, height } : null;
  });
  // As the display app does: the tape's gutter when it offers several dashboards, or when people show.
  protected readonly gutter = computed(() => {
    const display = this.display();
    if (!display) return 0;
    const people = (this.data.homeys() ?? []).some((h) => h.users.size > 0);
    return display.dashboardIds.length > 1 || people ? GUTTER : 0;
  });
  /** The page the dashboard lays out on, and how far it is scaled to fit below the header. */
  protected readonly frame = computed(() => {
    const roomWidth = this.width();
    const roomHeight = this.height() - this.barHeight();
    const screen = this.screen();
    if (!screen) return { width: roomWidth, height: roomHeight, scale: 1 };
    const scale = Math.min(1, (roomWidth - 2 * MARGIN) / screen.width, (roomHeight - 2 * MARGIN) / screen.height);
    return { ...screen, scale };
  });
  protected readonly cell = computed(() => {
    const { width, height } = this.frame();
    const layout = this.dashboard()?.draft;
    return fittedCellSize(width - this.gutter(), height, layout?.rows, layout?.sections.length);
  });
  protected readonly sizeLabel = computed(() => {
    const display = this.display();
    const screen = this.screen();
    if (!display) return 'The draft, fitted to this window';
    if (!screen) return `${display.name} hasn't said its screen size; fitted to this window`;
    const scale = this.frame().scale;
    return `${display.name} · ${screen.width} × ${screen.height}${scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ''}`;
  });

  constructor() {
    afterNextRender(() => this.onResize());
  }

  protected onResize() {
    this.height.set(window.innerHeight);
    this.width.set(window.innerWidth);
    this.barHeight.set(this.bar().nativeElement.offsetHeight);
  }
}
