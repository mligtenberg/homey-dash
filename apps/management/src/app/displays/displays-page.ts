import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DisplayStatus } from './display-status';
import { DisplaysStore } from './displays-store';

/** Every display at a glance, each opening to its own pages. Displays are added by running setup on a screen. */
@Component({
  selector: 'hd-displays-page',
  imports: [RouterLink, DisplayStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header">
      <h1>Displays</h1>
    </header>
    <div class="body">
      @if (store.loaded() && store.list().length === 0) {
        <div class="empty hd-panel">
          <h2>No displays yet</h2>
          <p>Open HomeyDash's display address on a screen in the home. It asks for a name and then shows up here.</p>
        </div>
      }
      <div class="grid">
        @for (display of store.list(); track display.id) {
          <a class="card hd-panel" [routerLink]="['/displays', display.id]">
            <h2>{{ display.name }}</h2>
            <hd-display-status [display]="display" />
            <p class="summary">{{ summary(display.dashboardIds.length, display.idleRules.length) }}</p>
          </a>
        }
      </div>
      @if (store.error(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styles: `
    .header { display: flex; align-items: center; padding: var(--space-4) var(--space-6); border-bottom: 1px solid var(--line); }
    h1 { font-size: 22px; font-weight: 800; margin: 0; }
    h2 { font-size: 18px; font-weight: 800; margin: 0 0 var(--space-2); }
    .body { padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); }
    .empty { padding: var(--space-6); max-width: 640px; }
    .empty p { margin: 0; color: var(--ink-muted); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-3); }
    .card { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); color: inherit; text-decoration: none; }
    .card:hover, .card:focus-visible { border-color: var(--brand); }
    .card h2 { margin: 0; }
    .summary { margin: 0; color: var(--ink-muted); font-size: 13px; }
    .error { margin: 0; color: var(--danger); font-weight: 700; }
  `,
})
export class DisplaysPage {
  protected readonly store = inject(DisplaysStore);

  protected summary(dashboards: number, rules: number) {
    const d = dashboards === 1 ? '1 dashboard' : `${dashboards} dashboards`;
    return rules ? `${d} · ${rules === 1 ? '1 idle rule' : `${rules} idle rules`}` : d;
  }
}
