import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PageHeader } from '../page-header';
import { PageTab, PageTabs } from '../page-tabs';
import { DisplayContext } from './display-context';
import { DisplayStatus } from './display-status';
import { DisplaysStore } from './displays-store';
import { TranslatePipe } from '@homey-dash/i18n';

/** One display: its name and status, and its details, and a page for each part of its setup. */
@Component({
  selector: 'hd-display-page',
  imports: [PageHeader, PageTabs, RouterOutlet, DisplayStatus, TranslatePipe],
  providers: [DisplayContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.display(); as display) {
      <hd-page-header section="displays" [title]="display.name" [crumbs]="crumbs" [purpose]="null">
        <hd-display-status status [display]="display" />
      </hd-page-header>
      <hd-page-tabs [tabs]="tabs" label="Display pages" />
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
    .body { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-6); max-width: 900px; }
  `,
})
export class DisplayPage {
  protected readonly context = inject(DisplayContext);
  protected readonly store = inject(DisplaysStore);
  protected readonly crumbs = [{ label: 'Displays', link: '/displays' }];
  // Each page says what it holds, so the right one is found without opening them all.
  protected readonly tabs: PageTab[] = [
    { path: 'details', label: 'Status', hint: 'Name, screenshot, screen' },
    { path: 'dashboards', label: 'Dashboards', hint: 'What it offers' },
    { path: 'idle', label: 'When idle', hint: 'Photos, screen off' },
    { path: 'lock', label: 'Lock screen', hint: 'Widgets over photos' },
  ];
}
