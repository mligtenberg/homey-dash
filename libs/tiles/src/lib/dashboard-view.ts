import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DashboardLayout } from '@homey-dash/api-client';
import { TileHost } from './tile-host';

/**
 * A dashboard version as displays show it: sections side by side, scrolling horizontally.
 * Set `--cell` on an `.hd-display` ancestor (see `cellSize` in libs/layout).
 */
@Component({
  selector: 'hd-dashboard-view',
  imports: [TileHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-dashboard' },
  template: `
    @for (section of layout().sections; track section.id) {
      <div class="hd-section">
        <div class="hd-section__title">{{ section.title }}</div>
        <div class="hd-section__grid" [style.--rows]="layout().rows">
          @for (tile of section.tiles; track tile.id) {
            <hd-tile-host [tile]="tile" />
          }
        </div>
      </div>
    }
  `,
})
export class DashboardView {
  readonly layout = input.required<DashboardLayout>();
}
