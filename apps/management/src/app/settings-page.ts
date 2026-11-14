import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@homey-dash/i18n';
import { PageHeader } from './page-header';
import { PageTab, PageTabs } from './page-tabs';

/** Settings: the accounts HomeyDash talks to, the speech model that hears spoken commands, and the language Management speaks, one tab each. */
@Component({
  selector: 'hd-settings-page',
  imports: [PageHeader, PageTabs, RouterOutlet, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-page-header section="settings" [title]="'Settings' | t" [purpose]="null" />
    <hd-page-tabs [tabs]="tabs" label="Settings pages" />
    <div class="body"><router-outlet /></div>
  `,
  styles: `
    :host { display: block; --sec: var(--sec-settings); }
    hd-page-header { border-bottom: 0; }
    .body { padding: var(--space-6); max-width: 640px; }
    @media (max-width: 860px) { .body { padding: var(--space-4); } }
  `,
})
export class SettingsPage {
  // Each tab says what it holds, as the display pages do.
  protected readonly tabs: PageTab[] = [
    { path: 'accounts', label: 'Accounts', hint: 'Homey, Immich, Plex, TomTom, AirPlay' },
    { path: 'speech', label: 'Speech recognition', hint: 'The model, and what was heard' },
    { path: 'language', label: 'Language', hint: 'For Management' },
  ];
}
