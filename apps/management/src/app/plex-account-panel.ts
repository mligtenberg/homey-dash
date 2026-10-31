import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { PlexAccountApi, PlexAccountInfo, PlexServer } from '@homey-dash/api-client';
import { firstValueFrom } from 'rxjs';
import { problem } from './immich-albums';

/** How often the panel looks whether someone approved the sign-in on Plex's page. */
const CHECK_MS = 2000;

/**
 * The Plex account, for Plex tiles (ADR-0009). Signing in happens on Plex's own page, in a new tab; HomeyDash notices
 * once someone approves it there, so this works from any address Management is opened at. An account with several
 * servers chooses one here.
 */
@Component({
  selector: 'hd-plex-account-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="account hd-panel" aria-labelledby="plex-title">
      <div class="head">
        <h2 id="plex-title">Plex</h2>
        @if (account(); as account) {
          @if (account.fake) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Fake Plex</span>
          } @else if (account.serverId) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Signed in</span>
          } @else if (account.signedIn) {
            <span class="hd-pill hd-pill--warn hd-pill--dot">Choose a server</span>
          } @else {
            <span class="hd-pill hd-pill--warn hd-pill--dot">Not signed in</span>
          }
        }
      </div>
      @if (account(); as account) {
        @if (account.signIn?.state === 'waiting') {
          <p class="muted" role="status">Waiting for you to approve HomeyDash on Plex's page, in the tab that opened.</p>
          <div class="actions">
            @if (account.signIn.authUrl; as url) {
              <a class="hd-btn" [href]="url" target="_blank" rel="noopener">Open Plex's page again</a>
            }
            <button class="hd-btn" type="button" (click)="cancel()">Cancel</button>
          </div>
        } @else if (!account.signedIn) {
          <p class="muted">Sign in with the Plex account whose server Plex tiles show: what plays and what was newly added.</p>
          <div class="actions">
            <button class="hd-btn hd-btn--primary" type="button" [disabled]="busy()" (click)="signIn()">Sign in with Plex</button>
          </div>
        } @else {
          @if (account.serverId && !servers()) {
            <p class="muted">
              Plex tiles show {{ account.serverName }}{{ account.username ? ', as ' + account.username : '' }}{{
                account.fake ? ', a fake server set in the configuration' : ''
              }}.
            </p>
          } @else {
            <form class="form" (submit)="choose($event, server.value)">
              <div class="hd-field">
                <label class="hd-field__label" for="plex-server">Server</label>
                <select #server id="plex-server" class="hd-select">
                  @if (!servers()) {
                    <option value="">Loading servers…</option>
                  }
                  @for (option of servers(); track option.id) {
                    <option [value]="option.id" [selected]="option.id === account.serverId">
                      {{ option.name }}{{ option.owned ? '' : ' (shared with you)' }}
                    </option>
                  }
                </select>
              </div>
              <div class="actions">
                <button class="hd-btn hd-btn--primary" type="submit" [disabled]="busy() || !servers()">
                  {{ busy() ? 'Connecting…' : 'Use this server' }}
                </button>
                @if (account.serverId) {
                  <button class="hd-btn" type="button" (click)="servers.set(null)">Cancel</button>
                }
              </div>
            </form>
          }
          @if (!account.fake) {
            <div class="actions">
              @if (account.serverId && !servers()) {
                <button class="hd-btn" type="button" (click)="loadServers()">Change server</button>
              }
              <button class="hd-btn hd-btn--danger" type="button" (click)="signOut()">Sign out</button>
            </div>
          }
        }
        @if (account.signIn; as signIn) {
          @if (signIn.state === 'failed') {
            <p class="error" role="alert">{{ signIn.error }}</p>
          }
        }
      }
      @if (error(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
    </section>
  `,
  styles: `
    .account { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); }
    .head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
    h2 { font-size: 18px; font-weight: 800; margin: 0; }
    .form { display: flex; flex-direction: column; gap: var(--space-4); }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .muted { color: var(--ink-muted); margin: 0; }
    .error { margin: 0; color: var(--danger); font-weight: 700; }
  `,
})
export class PlexAccountPanel {
  private readonly api = inject(PlexAccountApi);

  protected readonly account = signal<PlexAccountInfo | null>(null);
  /** The account's servers while someone chooses one. */
  protected readonly servers = signal<PlexServer[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private checker?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.checker));
    this.load();
  }

  // Opens the tab at once, from the click, so it isn't blocked; it goes to Plex's page once HomeyDash has it.
  protected async signIn() {
    const tab = window.open('', '_blank');
    this.busy.set(true);
    try {
      const { url } = await firstValueFrom(this.api.signIn());
      if (tab) tab.location.href = url;
      this.error.set(null);
      await this.load();
    } catch (e) {
      tab?.close();
      this.error.set(problem(e, 'Could not start signing in with Plex. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancel() {
    await firstValueFrom(this.api.cancelSignIn()).catch(() => undefined);
    await this.load();
  }

  protected async loadServers() {
    this.servers.set(null);
    try {
      const servers = await firstValueFrom(this.api.servers());
      this.servers.set(servers);
      if (!servers.length) this.error.set('This Plex account has no servers. Sign in with the account that owns or shares one.');
    } catch (e) {
      this.error.set(problem(e, 'Could not load the Plex servers. Try again.'));
    }
  }

  protected async choose(event: Event, id: string) {
    event.preventDefault();
    if (!id) return;
    this.busy.set(true);
    try {
      this.account.set(await firstValueFrom(this.api.chooseServer(id)));
      this.servers.set(null);
      this.error.set(null);
    } catch (e) {
      this.error.set(problem(e, 'Could not connect to that server. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async signOut() {
    try {
      await firstValueFrom(this.api.signOut());
      this.servers.set(null);
      await this.load();
    } catch {
      this.error.set('Could not sign out. Try again.');
    }
  }

  // Keeps looking while a sign-in waits; an account without a server lists its servers to choose from.
  private async load() {
    clearTimeout(this.checker);
    try {
      const account = await firstValueFrom(this.api.get());
      this.account.set(account);
      if (account.signIn?.state === 'waiting') this.checker = setTimeout(() => this.load(), CHECK_MS);
      else if (account.signedIn && !account.serverId && !this.servers()) await this.loadServers();
    } catch {
      this.error.set('Could not load the Plex account.');
    }
  }
}
