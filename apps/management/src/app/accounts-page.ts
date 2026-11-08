import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AirPlayPanel } from './airplay-panel';
import { HomeyAccountPanel } from './homey-account-panel';
import { ImmichAccountPanel } from './immich-account-panel';
import { PlexAccountPanel } from './plex-account-panel';

/**
 * The accounts HomeyDash holds for the home (ADR-0007): Homeys, each with its address and local API key, Immich
 * accounts, each with its address and API key, Plex accounts, signed in on Plex's own page, and the Apple TVs for AirPlay, found on the network. Keys are write-only;
 * HomeyDash never sends them back.
 */
@Component({
  selector: 'hd-accounts-page',
  imports: [AirPlayPanel, HomeyAccountPanel, ImmichAccountPanel, PlexAccountPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="hd-page__header">
      <h1 class="hd-page__title">Accounts</h1>
    </header>
    <div class="hd-page__body hd-page__body--narrow">
      <hd-homey-account-panel />
      <hd-immich-account-panel />
      <hd-plex-account-panel />
      <hd-airplay-panel />
    </div>
  `
})
export class AccountsPage {}
