import { ConfirmInline } from '@homey-dash/design-system';
import { AccountPanel } from './account-panel';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { apiProblem, PlexAccount, PlexAccountApi, PlexAccounts, PlexServer } from '@homey-dash/api-client';
import { firstValueFrom } from 'rxjs';
import { TranslatePipe, t } from '@homey-dash/i18n';

/** How often the panel looks whether someone approved the sign-in on Plex's page. */
const CHECK_MS = 2000;

/**
 * The Plex accounts, for Plex tiles (ADR-0009), each with a name, such as one per server. Signing in happens on Plex's
 * own page, in a new tab; HomeyDash notices once someone approves it there, so this works from any address Management
 * is opened at. An account with several servers chooses one here. Signing an account in again keeps its tiles.
 */
@Component({
  selector: 'hd-plex-account-panel',
  imports: [AccountPanel, ConfirmInline, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-account-panel key="plex" [title]="'Plex' | t" [error]="error()">
      <ng-container ngProjectAs="[status]">
        @if (info(); as info) {
          @if (info.fake) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">{{ 'Fake Plex' | t }}</span>
          } @else if (!info.accounts.length) {
            <span class="hd-pill hd-pill--warn hd-pill--dot">{{ 'Not signed in' | t }}</span>
          } @else if (info.accounts.some(noServer)) {
            <span class="hd-pill hd-pill--warn hd-pill--dot">{{ 'Choose a server' | t }}</span>
          } @else {
            <span class="hd-pill hd-pill--ok hd-pill--dot">{{ 'Signed in' | t }}</span>
          }
        }
      </ng-container>
      @if (info(); as info) {
        <p class="hd-muted">
          @if (info.fake) {
            HomeyDash runs against a fake Plex server, set in its configuration.
          } @else {
            Plex tiles show what plays and what was newly added on a Plex server. Add an account for each server you want
            tiles of; each tile picks one.
          }
        </p>
        @for (account of info.accounts; track account.id) {
          <div class="hd-account__item">
            @if (renaming() === account.id) {
              <form class="form" (submit)="rename($event, account, newName.value)">
                <div class="hd-field">
                  <label class="hd-field__label" for="plex-rename">{{ 'Name' | t }}</label>
                  <input #newName id="plex-rename" class="hd-input" autocomplete="off" [value]="account.name" (keydown.escape)="renaming.set(null)" />
                  @if (nameError(); as error) {
                    <span class="hd-error hd-small">{{ error }}</span>
                  }
                </div>
                <div class="hd-actions">
                  <button class="hd-btn hd-btn--primary" type="submit">{{ 'Save' | t }}</button>
                  <button class="hd-btn" type="button" (click)="renaming.set(null)">{{ 'Cancel' | t }}</button>
                </div>
              </form>
            } @else {
              <div class="hd-account__info">
                <strong>{{ account.name }}</strong>
                @if (account.serverId) {
                  <span class="hd-muted">{{ account.serverName }}{{ account.username ? ', as ' + account.username : '' }}</span>
                } @else {
                  <span class="warn">{{ 'Choose a server' | t }}</span>
                }
              </div>
              @if (!info.fake) {
                <div class="hd-actions">
                  @if (removing() === account.id) {
                    <hd-confirm-inline
                      message="Its Plex tiles show Plex as not set up until you give them another account."
                      (confirmed)="remove(account)"
                      (cancelled)="removing.set(null)"
                    />
                  } @else if (choosing() !== account.id) {
                    <button class="hd-btn" type="button" (click)="startRenaming(account)">{{ 'Rename' | t }}</button>
                    <button class="hd-btn" type="button" (click)="loadServers(account)">{{ (account.serverId ? 'Change server' : 'Choose server') | t }}</button>
                    <button class="hd-btn" type="button" [disabled]="busy()" (click)="signIn({ accountId: account.id })">{{ 'Sign in again' | t }}</button>
                    <button class="hd-btn hd-btn--danger" type="button" (click)="removing.set(account.id)">{{ 'Remove' | t }}</button>
                  }
                </div>
              }
            }
            @if (choosing() === account.id) {
              <form class="form" (submit)="choose($event, account, server.value)">
                <div class="hd-field">
                  <label class="hd-field__label" for="plex-server">{{ 'Server' | t }}</label>
                  <select #server id="plex-server" class="hd-select">
                    @if (!servers()) {
                      <option value="">{{ 'Loading servers…' | t }}</option>
                    }
                    @for (option of servers(); track option.id) {
                      <option [value]="option.id" [selected]="option.id === account.serverId">
                        {{ option.name }}{{ (option.owned ? '' : ' (shared with you)') | t }}
                      </option>
                    }
                  </select>
                </div>
                <div class="hd-actions">
                  <button class="hd-btn hd-btn--primary" type="submit" [disabled]="busy() || !servers()">
                    {{ (busy() ? 'Connecting…' : 'Use this server') | t }}
                  </button>
                  <button class="hd-btn" type="button" (click)="choosing.set(null)">{{ 'Cancel' | t }}</button>
                </div>
              </form>
            }
          </div>
        }
        @if (info.signIn; as signIn) {
          @if (signIn.state === 'waiting') {
            <div class="hd-account__item">
              <p class="hd-muted" role="status">
                Waiting for you to approve HomeyDash on Plex's page, in the tab that opened, for {{ signIn.name }}.
              </p>
              <div class="hd-actions">
                @if (signIn.authUrl; as url) {
                  <a class="hd-btn" [href]="url" target="_blank" rel="noopener">{{ "Open Plex's page again" | t }}</a>
                }
                <button class="hd-btn" type="button" (click)="cancel()">{{ 'Cancel' | t }}</button>
              </div>
            </div>
          } @else {
            <p class="hd-error" role="alert">{{ signIn.error }}</p>
          }
        }
        @if (!info.fake && info.signIn?.state !== 'waiting') {
          @if (adding() || !info.accounts.length) {
            <form class="form hd-account__item" (submit)="add($event, name.value)">
              <div class="hd-field">
                <label class="hd-field__label" for="plex-name">{{ 'Name' | t }}</label>
                <input
                  #name
                  id="plex-name"
                  class="hd-input"
                  autocomplete="off"
                  [placeholder]="'Such as Home or Cinema' | t"
                  [attr.aria-invalid]="!!nameError() && !renaming()"
                />
                @if (nameError() && !renaming()) {
                  <span class="hd-error hd-small">{{ nameError() }}</span>
                }
              </div>
              <div class="hd-actions">
                <button class="hd-btn hd-btn--primary" type="submit" [disabled]="busy()">{{ 'Sign in with Plex' | t }}</button>
                @if (info.accounts.length) {
                  <button class="hd-btn" type="button" (click)="adding.set(false)">{{ 'Cancel' | t }}</button>
                }
              </div>
            </form>
          } @else {
            <div class="hd-actions">
              <button class="hd-btn" type="button" (click)="startAdding()">{{ 'Add another Plex account' | t }}</button>
            </div>
          }
        }
      }
    </hd-account-panel>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: var(--space-4); flex: 1 1 100%; }
    .warn { color: var(--warn); font-weight: 700; }
  `,
})
export class PlexAccountPanel {
  private readonly api = inject(PlexAccountApi);

  protected readonly info = signal<PlexAccounts | null>(null);
  protected readonly adding = signal(false);
  protected readonly renaming = signal<number | null>(null);
  protected readonly removing = signal<number | null>(null);
  /** The account choosing a server, with that account's servers once loaded. */
  protected readonly choosing = signal<number | null>(null);
  protected readonly servers = signal<PlexServer[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly nameError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly noServer = (account: PlexAccount) => !account.serverId;
  private checker?: ReturnType<typeof setTimeout>;
  // The account a finished sign-in may have left without a server, to list its servers once.
  private offered = new Set<number>();

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.checker));
    this.load();
  }

  protected startAdding() {
    this.nameError.set(null);
    this.adding.set(true);
  }

  protected startRenaming(account: PlexAccount) {
    this.nameError.set(null);
    this.renaming.set(account.id);
  }

  protected add(event: Event, name: string) {
    event.preventDefault();
    if (!name.trim()) {
      this.nameError.set(t('Give the account a name, such as whose it is.'));
      return;
    }
    this.signIn({ name: name.trim() });
  }

  // Opens the tab at once, from the click, so it isn't blocked; it goes to Plex's page once HomeyDash has it.
  protected async signIn(change: { name: string } | { accountId: number }) {
    const tab = window.open('', '_blank');
    this.busy.set(true);
    try {
      const { url } = await firstValueFrom(this.api.signIn(change));
      if (tab) tab.location.href = url;
      this.error.set(null);
      this.nameError.set(null);
      this.adding.set(false);
      await this.load();
    } catch (e) {
      tab?.close();
      if (e instanceof HttpErrorResponse && e.status === 400) this.nameError.set(apiProblem(e, t('Choose another name.')));
      else this.error.set(apiProblem(e, t('Could not start signing in with Plex. Try again.')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancel() {
    await firstValueFrom(this.api.cancelSignIn()).catch(() => undefined);
    await this.load();
  }

  protected async rename(event: Event, account: PlexAccount, name: string) {
    event.preventDefault();
    try {
      this.info.set(await firstValueFrom(this.api.rename(account.id, name)));
      this.renaming.set(null);
      this.nameError.set(null);
    } catch (e) {
      this.nameError.set(apiProblem(e, t('Could not rename the account. Try again.')));
    }
  }

  protected async loadServers(account: PlexAccount) {
    this.choosing.set(account.id);
    this.servers.set(null);
    try {
      const servers = await firstValueFrom(this.api.servers(account.id));
      this.servers.set(servers);
      if (!servers.length) this.error.set(t('This Plex account has no servers. Sign in with the account that owns or shares one.'));
    } catch (e) {
      this.choosing.set(null);
      this.error.set(apiProblem(e, `Could not load the servers of ${account.name}. Try again.`));
    }
  }

  protected async choose(event: Event, account: PlexAccount, serverId: string) {
    event.preventDefault();
    if (!serverId) return;
    this.busy.set(true);
    try {
      this.info.set(await firstValueFrom(this.api.chooseServer(account.id, serverId)));
      this.choosing.set(null);
      this.error.set(null);
    } catch (e) {
      this.error.set(apiProblem(e, t('Could not connect to that server. Try again.')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(account: PlexAccount) {
    try {
      this.info.set(await firstValueFrom(this.api.remove(account.id)));
      this.removing.set(null);
    } catch {
      this.error.set(t('Could not remove the account. Try again.'));
    }
  }

  // Keeps looking while a sign-in waits; an account a sign-in left without a server lists its servers to choose from.
  private async load() {
    clearTimeout(this.checker);
    try {
      const info = await firstValueFrom(this.api.list());
      this.info.set(info);
      if (info.signIn?.state === 'waiting') {
        this.checker = setTimeout(() => this.load(), CHECK_MS);
        return;
      }
      const unserved = info.accounts.find((a) => !a.serverId && !this.offered.has(a.id));
      if (unserved && this.choosing() === null) {
        this.offered.add(unserved.id);
        await this.loadServers(unserved);
      }
    } catch {
      this.error.set(t('Could not load the Plex accounts.'));
    }
  }
}
