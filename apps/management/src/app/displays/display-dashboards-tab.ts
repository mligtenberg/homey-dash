import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DisplayContext } from './display-context';
import { DisplaysStore } from './displays-store';
import { ReorderButtons } from '@homey-dash/design-system';
import { TranslatePipe } from '@homey-dash/i18n';

/** The dashboards a display offers, in the order of its tape. It starts on the first. */
@Component({
  selector: 'hd-display-dashboards-tab',
  imports: [ReorderButtons, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.display(); as display) {
      <div class="dashboards">
        <p class="hd-lead">{{ 'Choose the dashboards this display can switch between. They sit on its tape in the order below, and it starts on the first.' | t }}</p>

        <section aria-labelledby="offered-title" class="group">
          <h2 class="hd-section-title" id="offered-title">{{ 'On this display' | t }}</h2>
          @for (id of display.dashboardIds; track id; let i = $index, first = $first, last = $last) {
            <div class="hd-item row">
              <span class="num" aria-hidden="true">{{ i + 1 }}</span>
              <div class="name">
                <span class="hd-item__title">{{ store.dashboardName(id) }}</span>
                @if (first) {
                  <span class="hd-item__sub">{{ 'Shown first' | t }}</span>
                }
              </div>
              <hd-reorder-buttons [label]="store.dashboardName(id)" [first]="first" [last]="last" [removable]="false" (moved)="store.moveDashboard(display, i, $event)" />
              <button type="button" class="hd-btn" [attr.aria-label]="'Take ' + store.dashboardName(id) + ' off this display'" (click)="store.offer(display, id, false)">{{ 'Remove' | t }}</button>
            </div>
          } @empty {
            <p class="hd-hint empty">{{ 'Nothing yet. The display waits until you add a dashboard.' | t }}</p>
          }
        </section>

        <section aria-labelledby="available-title" class="group">
          <h2 class="hd-section-title" id="available-title">{{ 'Available to add' | t }}</h2>
          @for (option of store.offerable(display); track option.id) {
            <div class="hd-item row">
              <span class="name"><span class="hd-item__title">{{ option.name }}</span></span>
              <button type="button" class="hd-btn" [attr.aria-label]="'Add ' + option.name + ' to this display'" (click)="store.offer(display, option.id, true)">{{ 'Add' | t }}</button>
            </div>
          } @empty {
            <p class="hd-hint empty">{{ (display.dashboardIds.length ? 'Every published dashboard is already on this display.' : 'Publish a dashboard to offer it here.') | t }}</p>
          }
        </section>
      </div>
    }
  `,
  styles: `
    .dashboards { display: flex; flex-direction: column; gap: var(--space-5); }
    .group { display: flex; flex-direction: column; gap: var(--space-2); }
    .group h2 { margin-bottom: var(--space-1); }
    .row { flex-direction: row; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); }
    .num { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: color-mix(in oklab, var(--brand) 14%, transparent); color: var(--brand); font-weight: 800; font-size: 13px; font-variant-numeric: tabular-nums; }
    .name { flex: 1; min-width: 0; display: flex; flex-direction: column; margin-left: var(--space-1); }
    .empty { padding: var(--space-3); border: 1px dashed var(--line); border-radius: 12px; }
  `,
})
export class DisplayDashboardsTab {
  protected readonly context = inject(DisplayContext);
  protected readonly store = inject(DisplaysStore);
}
