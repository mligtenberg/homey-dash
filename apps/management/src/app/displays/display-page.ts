import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PageHeader } from '../page-header';
import { DisplayContext } from './display-context';
import { DisplayStatus } from './display-status';
import { DisplaysStore } from './displays-store';
import { TranslatePipe } from '@homey-dash/i18n';

/** One display: its name and status, and its details, and a page for each part of its setup. */
@Component({
  selector: 'hd-display-page',
  imports: [PageHeader, RouterLink, RouterLinkActive, RouterOutlet, DisplayStatus, TranslatePipe],
  providers: [DisplayContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.display(); as display) {
      <hd-page-header section="displays" [title]="display.name" [crumbs]="crumbs" [purpose]="null">
        <hd-display-status status [display]="display" />
      </hd-page-header>
      <nav class="tabs" [attr.aria-label]="'Display pages' | t">
        @for (tab of tabs; track tab.path) {
          <a class="tab" [routerLink]="tab.path" routerLinkActive ariaCurrentWhenActive="page"><span class="tab__label">{{ tab.label }}</span><small>{{ tab.hint }}</small></a>
        }
      </nav>
      <div class="body">
        <router-outlet />
        @if (store.error(); as error) {
          <p class="hd-error" role="alert">{{ error }}</p>
        }
      </div>
    } @else if (store.loaded()) {
      <hd-page-header section="displays" [title]="'Display not found' | t" [crumbs]="crumbs" [purpose]="null" />
    }
  `,
  styles: `
    :host { display: block; --sec: var(--sec-displays); }
    hd-page-header { border-bottom: 0; }
    .tabs { display: flex; gap: var(--space-1); padding: 0 var(--space-6); background: var(--panel); border-bottom: 1px solid var(--line); overflow-x: auto; }
    .tab { display: flex; flex-direction: column; padding: 8px 14px 10px; color: var(--ink-soft); font-weight: 600; text-decoration: none; white-space: nowrap; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tab small { font-size: 12px; font-weight: 500; color: var(--ink-muted); }
    .tab:hover { color: var(--ink); }
    .tab[aria-current='page'] { color: var(--ink); border-bottom-color: var(--sec); }
    .body { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-6); max-width: 900px; }
    .tab:focus-visible { outline: 3px solid var(--brand); outline-offset: -3px; border-radius: 6px; }
  `,
})
export class DisplayPage {
  protected readonly context = inject(DisplayContext);
  protected readonly store = inject(DisplaysStore);
  protected readonly crumbs = [{ label: 'Displays', link: '/displays' }];
  // Each page says what it holds, so the right one is found without opening them all.
  protected readonly tabs = [
    { path: 'details', label: 'Status', hint: 'Name, screenshot, screen' },
    { path: 'dashboards', label: 'Dashboards', hint: 'What it offers' },
    { path: 'idle', label: 'When idle', hint: 'Photos, screen off' },
    { path: 'lock', label: 'Lock screen', hint: 'Widgets over photos' },
  ];
}
