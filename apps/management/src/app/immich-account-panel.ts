import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { fieldErrors, ImmichAccount, ImmichAccountApi, ImmichAccounts } from '@homey-dash/api-client';
import { ImmichPartners } from './immich-partners';

/**
 * The Immich accounts, whose albums photo sets follow: each a name, the server's address and an API key made in
 * Immich, such as one per person's Immich. HomeyDash checks the address and key with Immich before keeping them.
 * Removing one keeps its photo sets, but displays can't fetch their photos until each set is given another account.
 * Under each, the partners who share their photos with it, who can be given a key of their own to rotate them.
 */
@Component({
  selector: 'hd-immich-account-panel',
  imports: [NgTemplateOutlet, ImmichPartners],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hd-account hd-panel" aria-labelledby="immich-title">
      <div class="hd-account__head">
        <h2 class="hd-panel__title" id="immich-title">Immich</h2>
        @if (info(); as info) {
          @if (info.fake) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Fake Immich</span>
          } @else if (info.accounts.length) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Set up</span>
          } @else {
            <span class="hd-pill hd-pill--warn hd-pill--dot">Not set up</span>
          }
        }
      </div>
      @if (info(); as info) {
        @if (info.fake) {
          <p class="hd-muted">HomeyDash runs against a fake Immich with sample albums, set in its configuration.</p>
          @for (account of info.accounts; track account.id) {
            <div class="hd-account__item"><hd-immich-partners [account]="account" /></div>
          }
        } @else {
          <p class="hd-muted">
            Photo sets follow albums in Immich. Add an account for each Immich server, or for each person whose photos you
            want to show. Displays get their photos through HomeyDash, so only HomeyDash needs to reach Immich.
          </p>
          @for (account of info.accounts; track account.id) {
            <div class="hd-account__item">
              @if (editing() === account.id) {
                <ng-container *ngTemplateOutlet="form; context: { $implicit: account }" />
              } @else {
                <div class="hd-account__info">
                  <strong>{{ account.name }}</strong>
                  <span class="hd-muted">{{ account.address }}</span>
                </div>
                <div class="hd-actions">
                  @if (removing() === account.id) {
                    <span class="hd-muted">Its photo sets stay, but displays can't show their photos until you give them another account.</span>
                    <button class="hd-btn hd-btn--danger" type="button" (click)="remove(account)">Remove</button>
                    <button class="hd-btn" type="button" (click)="removing.set(null)">Cancel</button>
                  } @else {
                    <button class="hd-btn" type="button" (click)="edit(account.id)">Edit</button>
                    <button class="hd-btn hd-btn--danger" type="button" (click)="removing.set(account.id)">Remove</button>
                  }
                </div>
                <hd-immich-partners [account]="account" />
              }
            </div>
          }
          @if (editing() === 'new') {
            <div class="hd-account__item">
              <ng-container *ngTemplateOutlet="form; context: { $implicit: null }" />
            </div>
          } @else if (editing() === null) {
            <div class="hd-actions">
              <button class="hd-btn" [class.hd-btn--primary]="!info.accounts.length" type="button" (click)="edit('new')">
                {{ info.accounts.length ? 'Add another Immich account' : 'Set up Immich' }}
              </button>
            </div>
          }
        }
      }
      @if (error(); as error) {
        <p class="hd-error" role="alert">{{ error }}</p>
      }
    </section>

    <ng-template #form let-account>
      <form class="form" (submit)="save($event, account, name.value, address.value, apiKey)">
        <div class="hd-field">
          <label class="hd-field__label" for="immich-name">Name</label>
          <input
            #name
            id="immich-name"
            class="hd-input"
            autocomplete="off"
            placeholder="Such as Home or Anna's photos"
            [value]="account?.name ?? ''"
            [attr.aria-invalid]="!!errors()['name']"
            aria-describedby="immich-name-error"
          />
          @if (errors()['name']; as error) {
            <span id="immich-name-error" class="hd-error hd-small">{{ error }}</span>
          }
        </div>
        <div class="hd-field">
          <label class="hd-field__label" for="immich-address">Address</label>
          <input
            #address
            id="immich-address"
            class="hd-input"
            autocomplete="off"
            placeholder="192.168.1.20:2283 or https://photos.example.com"
            [value]="account?.address ?? ''"
            [attr.aria-invalid]="!!errors()['address']"
            aria-describedby="immich-address-error"
          />
          @if (errors()['address']; as error) {
            <span id="immich-address-error" class="hd-error hd-small">{{ error }}</span>
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
            [placeholder]="account ? 'Leave empty to keep the current key' : ''"
            [attr.aria-invalid]="!!errors()['apiKey']"
            aria-describedby="immich-key-hint"
          />
          <span id="immich-key-hint" [class]="errors()['apiKey'] ? 'hd-error hd-small' : 'hd-hint'">
            {{
              errors()['apiKey'] ??
                'Make one in Immich under Account Settings → API Keys, with at least album.read, asset.read, asset.view, face.read and person.read.'
            }}
          </span>
        </div>
        <div class="hd-actions">
          <button class="hd-btn hd-btn--primary" type="submit" [disabled]="saving()">
            {{ saving() ? 'Checking with Immich…' : account ? 'Save' : 'Add account' }}
          </button>
          <button class="hd-btn" type="button" (click)="edit(null)">Cancel</button>
        </div>
      </form>
    </ng-template>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: var(--space-4); flex: 1; }
  `,
})
export class ImmichAccountPanel {
  private readonly api = inject(ImmichAccountApi);

  protected readonly info = signal<ImmichAccounts | null>(null);
  /** The account whose form is open, 'new' while adding one. */
  protected readonly editing = signal<number | 'new' | null>(null);
  protected readonly removing = signal<number | null>(null);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  constructor() {
    this.api.list().subscribe({ next: (info) => this.done(info), error: () => this.fail('load') });
  }

  protected edit(which: number | 'new' | null) {
    this.editing.set(which);
    this.removing.set(null);
    this.errors.set({});
    this.error.set(null);
  }

  protected save(event: Event, account: ImmichAccount | null, name: string, address: string, apiKey: HTMLInputElement) {
    event.preventDefault();
    this.saving.set(true);
    const request = account
      ? this.api.update(account.id, name, address, apiKey.value)
      : this.api.add(name, address, apiKey.value);
    request.subscribe({
      next: (info) => this.done(info),
      error: (e: unknown) => {
        this.saving.set(false);
        const errors = fieldErrors(e);
        if (errors) {
          this.error.set(null);
          this.errors.set(errors);
        } else {
          this.fail('save');
        }
      },
    });
  }

  protected remove(account: ImmichAccount) {
    this.api.remove(account.id).subscribe({ next: (info) => this.done(info), error: () => this.fail('remove') });
  }

  private done(info: ImmichAccounts) {
    this.info.set(info);
    this.saving.set(false);
    this.edit(null);
  }

  private fail(what: string) {
    this.error.set(`Could not ${what} the Immich account. Try again.`);
  }
}
