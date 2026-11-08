import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DisplayContext } from './display-context';
import { DisplayStatus } from './display-status';
import { DisplaysStore } from './displays-store';

/** One display: its name and status, and its details, and a page for each part of its setup. */
@Component({
  selector: 'hd-display-page',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, DisplayStatus],
  providers: [DisplayContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.display(); as display) {
      <header class="header">
        <a class="back" routerLink="/displays">← Displays</a>
        <h1 class="hd-page__title">{{ display.name }}</h1>
        <hd-display-status [display]="display" />
      </header>
      <nav class="tabs" aria-label="Display pages">
        @for (tab of tabs; track tab.path) {
          <a class="tab" [routerLink]="tab.path" routerLinkActive ariaCurrentWhenActive="page">{{ tab.label }}</a>
        }
      </nav>
      <div class="body">
        <router-outlet />
        @if (store.error(); as error) {
          <p class="hd-error" role="alert">{{ error }}</p>
        }
      </div>
    } @else if (store.loaded()) {
      <header class="header">
        <a class="back" routerLink="/displays">← Displays</a>
        <h1 class="hd-page__title">Display not found</h1>
      </header>
    }
  `,
  styles: `
    .header { display: flex; flex-wrap: wrap; align-items: center; column-gap: var(--space-4); row-gap: var(--space-1); padding: var(--space-4) var(--space-6) var(--space-3); }
    .back { flex-basis: 100%; color: var(--ink-muted); font-size: 13px; text-decoration: none; }
    .back:hover { color: var(--brand); }
    .tabs { display: flex; gap: var(--space-1); padding: 0 var(--space-6); border-bottom: 1px solid var(--line); overflow-x: auto; }
    .tab { padding: 10px 14px; color: var(--ink-muted); font-weight: 700; text-decoration: none; white-space: nowrap; border-bottom: 3px solid transparent; margin-bottom: -1px; }
    .tab:hover { color: var(--ink); }
    .tab[aria-current='page'] { color: var(--brand); border-bottom-color: var(--brand); }
    .body { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5) var(--space-6); max-width: 900px; }
  `,
})
export class DisplayPage {
  protected readonly context = inject(DisplayContext);
  protected readonly store = inject(DisplaysStore);
  protected readonly tabs = [
    { path: 'details', label: 'Details' },
    { path: 'dashboards', label: 'Dashboards' },
    { path: 'idle', label: 'When idle' },
    { path: 'lock', label: 'Lock screen' },
  ];
}
