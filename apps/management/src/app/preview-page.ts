import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardDetail, DashboardsApi } from '@homey-dash/api-client';
import { fittedCellSize } from '@homey-dash/layout';
import { DashboardView } from '@homey-dash/tiles';
import { AsDisplayPicker } from './as-display-picker';

/** The draft rendered the way a display shows it, fitted to the Management window. */
@Component({
  selector: 'hd-preview-page',
  imports: [AsDisplayPicker, DashboardView, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-display', '[style.--cell.px]': 'cell()', '(window:resize)': 'onResize()' },
  template: `
    @if (dashboard(); as dashboard) {
      <hd-dashboard-view [layout]="dashboard.draft" />
    }
    <div class="tools">
      <hd-as-display-picker />
      <a class="hd-btn" [routerLink]="['/dashboards', id()]">Back to editor</a>
    </div>
  `,
  styles: `
    :host { display: block; height: 100dvh; overflow: hidden; position: relative; }
    hd-dashboard-view { height: 100%; box-sizing: border-box; }
    .tools { position: fixed; right: var(--space-4); bottom: var(--space-4); display: flex; gap: var(--space-2); }
    .tools .hd-btn { text-decoration: none; }
  `,
})
export class PreviewPage {
  readonly id = input.required<string>();

  private readonly api = inject(DashboardsApi);
  protected readonly dashboard = signal<DashboardDetail | null>(null);
  protected readonly height = signal(window.innerHeight);
  protected readonly width = signal(window.innerWidth);
  protected readonly cell = computed(() => fittedCellSize(this.width(), this.height(), this.dashboard()?.draft.rows));

  protected onResize() {
    this.height.set(window.innerHeight);
    this.width.set(window.innerWidth);
  }

  constructor() {
    effect((onCleanup) => {
      const loading = this.api.get(this.id()).subscribe((d) => this.dashboard.set(d));
      onCleanup(() => loading.unsubscribe());
    });
  }
}
