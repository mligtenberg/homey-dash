import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AirPlayPanel } from './airplay-panel';
import { PageHeader } from './page-header';
import { HomeyAccountPanel } from './homey-account-panel';
import { ImmichAccountPanel } from './immich-account-panel';
import { PlexAccountPanel } from './plex-account-panel';
import { SpeechPanel } from './speech-panel';
import { TomTomAccountPanel } from './tomtom-account-panel';
import { TranslatePipe } from '@homey-dash/i18n';

/**
 * The accounts HomeyDash holds for the home (ADR-0007): Homeys, each with its address and local API key, Immich
 * accounts, each with its address and API key, Plex accounts, signed in on Plex's own page, TomTom accounts, each with an API key, and the Apple TVs for AirPlay, found on the network. Keys are write-only;
 * HomeyDash never sends them back.
 */
@Component({
  selector: 'hd-accounts-page',
  imports: [PageHeader, AirPlayPanel, HomeyAccountPanel, ImmichAccountPanel, PlexAccountPanel, TomTomAccountPanel, SpeechPanel, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-page-header section="accounts" [title]="'Accounts' | t" />
    <div class="hd-page__body hd-page__body--narrow">
      <hd-homey-account-panel />
      <hd-immich-account-panel />
      <hd-plex-account-panel />
      <hd-tomtom-account-panel />
      <hd-speech-panel />
      <hd-airplay-panel />
    </div>
  `
})
export class AccountsPage {}
