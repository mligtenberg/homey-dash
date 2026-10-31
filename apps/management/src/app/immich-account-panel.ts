import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ImmichAccountApi, ImmichAccountInfo } from '@homey-dash/api-client';

/**
 * The Immich account, whose albums photo sets follow: the server's address and an API key made in Immich. HomeyDash
 * checks both with Immich before keeping them. Removing it keeps the photo sets, but displays can't fetch their photos.
 */
@Component({
  selector: 'hd-immich-account-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="account hd-panel" aria-labelledby="immich-title">
      <div class="head">
        <h2 id="immich-title">Immich</h2>
        @if (account(); as account) {
          @if (account.fake) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Fake Immich</span>
          } @else if (account.address) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Set up</span>
          } @else {
            <span class="hd-pill hd-pill--warn hd-pill--dot">Not set up</span>
          }
        }
      </div>
      @if (account(); as account) {
        @if (account.fake) {
          <p class="muted">HomeyDash runs against a fake Immich with sample albums, set in its configuration.</p>
        } @else {
          <p class="muted">Photo sets follow albums in Immich. Displays get their photos through HomeyDash, so only HomeyDash needs to reach Immich.</p>
          <form class="form" (submit)="save($event, address.value, apiKey)">
            <div class="hd-field">
              <label class="hd-field__label" for="immich-address">Address</label>
              <input
                #address
                id="immich-address"
                class="hd-input"
                autocomplete="off"
                placeholder="192.168.1.20:2283 or https://photos.example.com"
                [value]="account.address ?? ''"
                [attr.aria-invalid]="!!errors()['address']"
                aria-describedby="immich-address-error"
              />
              @if (errors()['address']; as error) {
                <span id="immich-address-error" class="field-error">{{ error }}</span>
              }
            </div>
            <div class="hd-field">
              <label class="hd-field__label" for="immich-key">API key</label>
              <input
                #apiKey
                id="immich-key"
                class="hd-input"
                type="password"
                autocomplete="off"
                [placeholder]="account.address ? 'Leave empty to keep the current key' : ''"
                [attr.aria-invalid]="!!errors()['apiKey']"
                aria-describedby="immich-key-hint"
              />
              <span id="immich-key-hint" [class]="errors()['apiKey'] ? 'field-error' : 'hint'">
                {{
                  errors()['apiKey'] ??
                    'Make one in Immich under Account Settings → API Keys, with at least album.read, asset.read, asset.view and person.read.'
                }}
              </span>
            </div>
            <div class="actions">
              @if (removing()) {
                <span class="muted">Photo sets stay, but displays can't show their photos until Immich is set up again.</span>
                <button class="hd-btn hd-btn--danger" type="button" (click)="remove()">Remove</button>
                <button class="hd-btn" type="button" (click)="removing.set(false)">Cancel</button>
              } @else {
                <button class="hd-btn hd-btn--primary" type="submit" [disabled]="saving()">
                  {{ saving() ? 'Checking with Immich…' : account.address ? 'Save' : 'Set up Immich' }}
                </button>
                @if (account.address) {
                  <button class="hd-btn hd-btn--danger" type="button" (click)="removing.set(true)">Remove Immich</button>
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
  `,
  styles: `
    .account { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); }
    .head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
    h2 { font-size: 18px; font-weight: 800; margin: 0; }
    .form { display: flex; flex-direction: column; gap: var(--space-4); }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .muted, .hint { color: var(--ink-muted); margin: 0; }
    .hint, .field-error { font-size: 13px; }
    .field-error { color: var(--danger); font-weight: 700; }
    .error { margin: 0; color: var(--danger); font-weight: 700; }
  `,
})
export class ImmichAccountPanel {
  private readonly api = inject(ImmichAccountApi);

  protected readonly account = signal<ImmichAccountInfo | null>(null);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly removing = signal(false);

  constructor() {
    this.api.get().subscribe({ next: (account) => this.done(account), error: () => this.fail('load') });
  }

  protected save(event: Event, address: string, apiKey: HTMLInputElement) {
    event.preventDefault();
    this.saving.set(true);
    this.api.set(address, apiKey.value).subscribe({
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
    this.api.remove().subscribe({ next: () => this.done({ fake: false, address: null }), error: () => this.fail('remove') });
  }

  private done(account: ImmichAccountInfo) {
    this.account.set(account);
    this.saving.set(false);
    this.removing.set(false);
    this.errors.set({});
    this.error.set(null);
  }

  private fail(what: string) {
    this.error.set(`Could not ${what} the Immich account. Try again.`);
  }
}
