import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DisplayContext } from './display-context';
import { DisplaysStore } from './displays-store';
import { ReorderButtons } from '@homey-dash/design-system';

/** The dashboards a display offers, in the order of its tape. It starts on the first. */
@Component({
  selector: 'hd-display-dashboards-tab',
  imports: [ReorderButtons],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.display(); as display) {
      <fieldset class="dashboards">
        <legend class="hd-field__label">Dashboards</legend>
        <p class="hd-hint">Check the ones this display offers. They sit on its tape in this order, and it starts on the first.</p>
        @for (id of display.dashboardIds; track id; let i = $index, first = $first, last = $last) {
          <div class="entry">
            <label class="hd-check">
              <input type="checkbox" checked (change)="store.offer(display, id, false)" />
              {{ store.dashboardName(id) }}
            </label>
            <hd-reorder-buttons [label]="store.dashboardName(id)" [first]="first" [last]="last" [removable]="false" (moved)="store.moveDashboard(display, i, $event)" />
          </div>
        }
        @for (option of store.offerable(display); track option.id) {
          <label class="hd-check">
            <input type="checkbox" (change)="store.offer(display, option.id, true)" />
            {{ option.name }}
          </label>
        } @empty {
          @if (!display.dashboardIds.length) {
            <span class="hd-hint">Publish a dashboard to offer it here.</span>
          }
        }
      </fieldset>
    }
  `,
  styles: `
    .dashboards { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); margin: 0; padding: 0; border: 0; }
    .dashboards legend { padding: 0; margin-bottom: var(--space-2); }
    .entry { display: flex; align-items: center; gap: var(--space-1); }
    .entry .hd-check { min-width: 180px; }
  `,
})
export class DisplayDashboardsTab {
  protected readonly context = inject(DisplayContext);
  protected readonly store = inject(DisplaysStore);
}
