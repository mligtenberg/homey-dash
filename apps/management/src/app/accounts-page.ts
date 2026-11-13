import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AirPlayPanel } from './airplay-panel';
import { HomeyAccountPanel } from './homey-account-panel';
import { ImmichAccountPanel } from './immich-account-panel';
import { PlexAccountPanel } from './plex-account-panel';
import { TomTomAccountPanel } from './tomtom-account-panel';

/**
 * The accounts HomeyDash holds for the home (ADR-0007): Homeys, each with its address and local API key, Immich
 * accounts, each with its address and API key, Plex accounts, signed in on Plex's own page, TomTom accounts, each with an API key, and the Apple TVs for AirPlay, found on the network. Keys are write-only;
 * HomeyDash never sends them back.
 */
@Component({
  selector: 'hd-accounts-page',
  imports: [AirPlayPanel, HomeyAccountPanel, ImmichAccountPanel, PlexAccountPanel, TomTomAccountPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panels">
      <hd-homey-account-panel />
      <hd-immich-account-panel />
      <hd-plex-account-panel />
      <hd-tomtom-account-panel />
      <hd-airplay-panel />
    </div>
  `,
  styles: `
    .panels { display: flex; flex-direction: column; gap: var(--space-4); }
  `,
})
export class AccountsPage {}
