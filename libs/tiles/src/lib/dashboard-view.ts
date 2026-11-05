import {
  afterEveryRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DashboardLayout } from '@homey-dash/api-client';
import { sectionsPerPage } from '@homey-dash/layout';
import { backgroundStyle, hasImage, renderedBackgroundStyle } from './background';
import { shownSections } from './logic/shown-sections';
import { TileHost } from './tile-host';

/**
 * A dashboard version as displays show it: as many whole sections as fit the width, centered, on pages
 * that swipe and snap, with a dot per page underneath.
 * Set `--cell` on an `.hd-display` ancestor (see `cellSize` in libs/layout).
 */
@Component({
  selector: 'hd-dashboard-view',
  imports: [TileHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'hd-dashboard',
    '[style.background]': 'background()',
    '[class.hd-has-image]': 'hasImage()',
  },
  template: `
    <div #pager class="hd-dashboard__pages" (scroll)="onScroll()">
      @for (page of pages(); track $index) {
        <div class="hd-dashboard__page">
          @for (section of page; track section.id) {
            <div class="hd-section">
              <div class="hd-section__title">{{ section.title }}</div>
              <div class="hd-section__grid" [style.--rows]="layout().rows">
                @for (tile of section.tiles; track tile.id) {
                  <hd-tile-host [tile]="tile" />
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
    @if (pages().length > 1) {
      <div class="hd-page-dots">
        @for (page of pages(); track $index) {
          <button
            type="button"
            class="hd-page-dot"
            [attr.aria-label]="'Show ' + sectionNames(page)"
            [attr.aria-current]="$index === current() || null"
            (click)="go($index)"
          ></button>
        }
      </div>
    }
  `,
})
export class DashboardView {
  readonly layout = input.required<DashboardLayout>();
  // How large the dashboard is, for a built-in image HomeyDash renders to fit it; unknown until first measured.
  private readonly size = signal<readonly [number, number] | null>(null);
  protected readonly background = computed(() => {
    const [background, size] = [this.layout().background, this.size()];
    if (background?.kind !== 'preset') return backgroundStyle(background);
    return size ? renderedBackgroundStyle(background, ...size) : null;
  });
  protected readonly hasImage = computed(() => hasImage(this.layout().background));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly pager = viewChild.required<ElementRef<HTMLElement>>('pager');

  private readonly shown = shownSections(() => this.layout().sections);
  private readonly perPage = signal(1);
  protected readonly current = signal(0);
  protected readonly pages = computed(() => {
    const shown = this.shown();
    const sections = this.layout().sections.filter((s) => shown.has(s.id));
    const perPage = this.perPage();
    const pages = [];
    for (let i = 0; i < sections.length; i += perPage) pages.push(sections.slice(i, i + perPage));
    return pages;
  });

  constructor() {
    // The width and --cell both change with the window, and both decide how many sections fit (and the size, how large a
    // built-in background is rendered). Without a
    // ResizeObserver (as in tests) a page holds one section.
    if (typeof ResizeObserver !== 'undefined') {
      const resizes = new ResizeObserver(() => {
        const [width, height] = [this.host.clientWidth, this.host.clientHeight];
        if (width > 0 && height > 0 && (this.size()?.[0] !== width || this.size()?.[1] !== height)) this.size.set([width, height]);
        this.measurePerPage();
      });
      resizes.observe(this.host);
      inject(DestroyRef).onDestroy(() => resizes.disconnect());
    }

    // --cell also changes without the host resizing (a dashboard with other rows, the window height settling on a
    // tablet whose browser bars move), so the observer alone leaves perPage stale and sections cut off at the edges.
    afterEveryRender({ read: () => this.measurePerPage() });

    // After the pages regroup or resize, stay on the page that was showing.
    afterRenderEffect(() => {
      const page = Math.min(untracked(this.current), this.pages().length - 1);
      const pager = this.pager().nativeElement;
      if (Math.abs(pager.scrollLeft - page * pager.clientWidth) > 1) {
        pager.scrollTo({ left: page * pager.clientWidth, behavior: 'instant' });
      }
    });
  }

  private measurePerPage() {
    const cell = parseFloat(getComputedStyle(this.host).getPropertyValue('--cell'));
    if (cell > 0 && this.host.clientWidth > 0) this.perPage.set(sectionsPerPage(this.host.clientWidth, cell));
  }

  protected onScroll() {
    const pager = this.pager().nativeElement;
    if (pager.clientWidth > 0) this.current.set(Math.round(pager.scrollLeft / pager.clientWidth));
  }

  protected go(page: number) {
    const pager = this.pager().nativeElement;
    pager.scrollTo({ left: page * pager.clientWidth, behavior: 'smooth' });
  }

  protected sectionNames(page: { title: string }[]) {
    return page.map((section) => section.title).join(', ');
  }
}
