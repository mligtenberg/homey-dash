import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AccountsApi, HomeyAccountInfo, HomeyStatus } from '@homey-dash/api-client';
import { RealtimeTileData } from '@homey-dash/tiles';
import { ImmichAccountPanel } from './immich-account-panel';
import { PlexAccountPanel } from './plex-account-panel';

/** How HomeyDash's connection to Homey reads in a status pill. */
export function homeyStatusPill(status: HomeyStatus | null): { label: string; tone: 'ok' | 'warn' | 'danger' | '' } {
  switch (status?.connection) {
    case 'connected':
      return { label: status.fake ? 'Fake Homey' : 'Connected', tone: 'ok' };
    case 'disconnected':
      return { label: 'Cannot connect', tone: 'danger' };
    case 'notSetUp':
      return { label: 'Not set up', tone: 'warn' };
    default:
      return { label: 'Connecting', tone: '' };
  }
}

/**
 * The accounts HomeyDash holds for the home (ADR-0007): Homey, with its address and local API key, Immich,
 * with its address and API key, and Plex, signed in on Plex's own page. Keys are write-only; HomeyDash never sends them back.
 */
@Component({
  selector: 'hd-accounts-page',
  imports: [ImmichAccountPanel, PlexAccountPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header">
      <h1>Accounts</h1>
    </header>
    <div class="body">
      <section class="account hd-panel" aria-labelledby="homey-title">
        <div class="head">
          <h2 id="homey-title">Homey</h2>
          @let pill = statusPill();
          <span class="hd-pill hd-pill--dot" [class]="pill.tone ? 'hd-pill--' + pill.tone : ''">{{ pill.label }}</span>
        </div>
        @if (account(); as account) {
          @if (account.fake) {
            <p class="muted">HomeyDash runs against a fake Homey with sample devices, set in its configuration.</p>
          } @else {
            @if (status()?.connection === 'disconnected' && status()?.lastError; as error) {
              <p class="muted" role="status">{{ error }}</p>
            }
            <form class="form" (submit)="save($event, address.value, apiKey)">
              <div class="hd-field">
                <label class="hd-field__label" for="homey-address">Address</label>
                <input
                  #address
                  id="homey-address"
                  class="hd-input"
                  autocomplete="off"
                  placeholder="192.168.1.10 or homey-….local"
                  [value]="account.address ?? ''"
                  [attr.aria-invalid]="!!errors()['address']"
                  aria-describedby="homey-address-error"
                />
                @if (errors()['address']; as error) {
                  <span id="homey-address-error" class="field-error">{{ error }}</span>
                }
              </div>
              <div class="hd-field">
                <label class="hd-field__label" for="homey-key">Local API key</label>
                <input
                  #apiKey
                  id="homey-key"
                  class="hd-input"
                  type="password"
                  autocomplete="off"
                  [placeholder]="account.address ? 'Leave empty to keep the current key' : ''"
                  [attr.aria-invalid]="!!errors()['apiKey']"
                  aria-describedby="homey-key-hint"
                />
                <span id="homey-key-hint" [class]="errors()['apiKey'] ? 'field-error' : 'hint'">
                  {{ errors()['apiKey'] ?? 'Make one in the Homey web app under Settings → API keys.' }}
                </span>
              </div>
              <div class="actions">
                @if (removing()) {
                  <span class="muted">Displays show connection lost until Homey is set up again.</span>
                  <button class="hd-btn hd-btn--danger" type="button" (click)="remove()">Remove</button>
                  <button class="hd-btn" type="button" (click)="removing.set(false)">Cancel</button>
                } @else {
                  <button class="hd-btn hd-btn--primary" type="submit" [disabled]="saving()">
                    {{ account.address ? 'Save' : 'Set up Homey' }}
                  </button>
                  @if (account.address) {
                    <button class="hd-btn hd-btn--danger" type="button" (click)="removing.set(true)">Remove Homey</button>
                  }
                }
              </div>
            </form>
          }
        }
        @if (error(); as error) {
          <p class="error" role="alert">{{ error }}</p>
        }
      </section>
      <hd-immich-account-panel />
      <hd-plex-account-panel />
    </div>
  `,
  styles: `
    .header { display: flex; align-items: center; padding: var(--space-4) var(--space-6); border-bottom: 1px solid var(--line); }
    h1 { font-size: 22px; font-weight: 800; margin: 0; }
    h2 { font-size: 18px; font-weight: 800; margin: 0; }
    .body { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); max-width: 640px; }
    .account { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); }
    .head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
    .form { display: flex; flex-direction: column; gap: var(--space-4); }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .muted, .hint { color: var(--ink-muted); margin: 0; }
    .hint, .field-error { font-size: 13px; }
    .field-error { color: var(--danger); font-weight: 700; }
    .error { margin: 0; color: var(--danger); font-weight: 700; }
  `,
})
export class AccountsPage {
  private readonly api = inject(AccountsApi);
  private readonly homey = inject(RealtimeTileData);

  protected readonly account = signal<HomeyAccountInfo | null>(null);
  protected readonly status = this.homey.status;
  protected readonly statusPill = computed(() => homeyStatusPill(this.status()));
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly removing = signal(false);

  constructor() {
    this.api.homey().subscribe({ next: (account) => this.account.set(account), error: () => this.fail('load') });
  }

  protected save(event: Event, address: string, apiKey: HTMLInputElement) {
    event.preventDefault();
    this.saving.set(true);
    this.api.setHomey(address, apiKey.value).subscribe({
      next: (account) => {
        this.done(account);
        apiKey.value = '';
      },
      error: (e: HttpErrorResponse) => {
        this.saving.set(false);
        if (e.status === 400 && e.error?.errors) {
          this.error.set(null);
          this.errors.set(Object.fromEntries(Object.entries(e.error.errors as Record<string, string[]>).map(([k, v]) => [k, v[0]])));
        } else {
          this.fail('save');
        }
      },
    });
  }

  protected remove() {
    this.api.removeHomey().subscribe({
      next: () => this.done({ fake: false, address: null }),
      error: () => this.fail('remove'),
    });
  }

  private done(account: HomeyAccountInfo) {
    this.account.set(account);
    this.saving.set(false);
    this.removing.set(false);
    this.errors.set({});
    this.error.set(null);
  }

  private fail(what: string) {
    this.error.set(`Could not ${what} the Homey account. Try again.`);
  }
}
