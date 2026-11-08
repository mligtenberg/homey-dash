import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DashboardsStore } from './dashboards-store';

/** Opens the first dashboard, or explains how to start when there is none. */
@Component({
  selector: 'hd-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.loaded() && store.list().length === 0) {
      <div class="empty hd-panel">
        <h1 class="hd-page__title">Build your first dashboard</h1>
        <p>A dashboard is a layout of tiles that one or more displays show. Choose <strong>New dashboard</strong> in the sidebar to start one.</p>
      </div>
    }
  `,
  styles: `
    h1 { margin-bottom: var(--space-2); }
    .empty { max-width: 460px; margin: 64px auto; padding: var(--space-6); }
    p { margin: 0; color: var(--ink-muted); }
  `,
})
export class HomePage {
  protected readonly store = inject(DashboardsStore);

  constructor() {
    const router = inject(Router);
    effect(() => {
      const first = this.store.list()[0];
      if (first) router.navigate(['/dashboards', first.id], { replaceUrl: true });
    });
  }
}
