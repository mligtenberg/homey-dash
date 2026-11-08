import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ConfirmInline } from '@homey-dash/design-system';
import { fieldErrors, TomTomAccount, TomTomAccountApi, TomTomAccounts } from '@homey-dash/api-client';
import { AccountPanel } from './account-panel';

/**
 * The TomTom accounts, whose routing and search traffic tiles use (ADR-0015): each a name and an API key made in the TomTom
 * developer portal. HomeyDash checks a new key with TomTom before it keeps it, and never sends it back. Removing one leaves
 * the traffic tiles and widgets that name it without traffic until they are given another account.
 */
@Component({
  selector: 'hd-tomtom-account-panel',
  imports: [AccountPanel, ConfirmInline, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-account-panel key="tomtom" title="TomTom" [error]="error()">
      <ng-container ngProjectAs="[status]">
        @if (info(); as info) {
          @if (info.fake) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Fake TomTom</span>
          } @else if (info.accounts.length) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Set up</span>
          } @else {
            <span class="hd-pill hd-pill--warn hd-pill--dot">Not set up</span>
          }
        }
      </ng-container>
      @if (info(); as info) {
        @if (info.fake) {
          <p class="hd-muted">HomeyDash runs against a fake TomTom with sample places and traffic, set in its configuration.</p>
        } @else {
          <p class="hd-muted">
            Traffic tiles show the car travel time on a route, with the delay over the usual time, from TomTom. Add an account with
            an API key from the TomTom developer portal (the free tier is plenty). Displays never see the key.
          </p>
          @for (account of info.accounts; track account.id) {
            <div class="hd-account__item">
              @if (editing() === account.id) {
                <ng-container *ngTemplateOutlet="form; context: { $implicit: account }" />
              } @else {
                <div class="hd-account__info">
                  <strong>{{ account.name }}</strong>
                </div>
                <div class="hd-actions">
                  @if (removing() === account.id) {
                    <hd-confirm-inline
                      message="Its traffic tiles and widgets show no traffic until you give them another account."
                      (confirmed)="remove(account)"
                      (cancelled)="removing.set(null)"
                    />
                  } @else {
                    <button class="hd-btn" type="button" (click)="edit(account.id)">Edit</button>
                    <button class="hd-btn hd-btn--danger" type="button" (click)="removing.set(account.id)">Remove</button>
                  }
                </div>
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
                {{ info.accounts.length ? 'Add another TomTom account' : 'Set up TomTom' }}
              </button>
            </div>
          }
        }
      }
    </hd-account-panel>

    <ng-template #form let-account>
      <form class="form" (submit)="submit($event, account, name.value, apiKey.value)">
        <div class="hd-field">
          <label class="hd-field__label" for="tomtom-name">Name</label>
          <input #name id="tomtom-name" class="hd-input" autocomplete="off" placeholder="Such as Home" [value]="account?.name ?? ''" [attr.aria-invalid]="!!errors()['name']" />
          @if (errors()['name']; as e) {
            <span class="hd-error hd-small">{{ e }}</span>
          }
        </div>
        <div class="hd-field">
          <label class="hd-field__label" for="tomtom-key">API key</label>
          <input #apiKey id="tomtom-key" class="hd-input" type="password" autocomplete="off" [placeholder]="account ? 'Leave empty to keep the current key' : ''" [attr.aria-invalid]="!!errors()['apiKey']" />
          <span [class]="errors()['apiKey'] ? 'hd-error hd-small' : 'hd-hint'">
            {{ errors()['apiKey'] ?? 'Make one in the TomTom developer portal, with the Routing and Search APIs enabled.' }}
          </span>
        </div>
        <div class="hd-actions">
          <button class="hd-btn hd-btn--primary" type="submit" [disabled]="saving()">{{ saving() ? 'Checking with TomTom…' : account ? 'Save' : 'Add account' }}</button>
          <button class="hd-btn" type="button" (click)="edit(null)">Cancel</button>
        </div>
      </form>
    </ng-template>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: var(--space-4); flex: 1; }
  `,
})
export class TomTomAccountPanel {
  private readonly api = inject(TomTomAccountApi);

  protected readonly info = signal<TomTomAccounts | null>(null);
  /** The account whose form is open, 'new' while adding one. */
  protected readonly editing = signal<number | 'new' | null>(null);
  protected readonly removing = signal<number | null>(null);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  constructor() {
    this.api.list().subscribe({ next: (a) => this.done(a), error: () => this.error.set('Could not load the TomTom account. Try again.') });
  }

  protected edit(which: number | 'new' | null) {
    this.editing.set(which);
    this.removing.set(null);
    this.errors.set({});
    this.error.set(null);
  }

  private done(answer: TomTomAccounts) {
    this.info.set(answer);
    this.saving.set(false);
    this.edit(null);
  }

  protected submit(event: Event, account: TomTomAccount | null, name: string, apiKey: string) {
    event.preventDefault();
    this.saving.set(true);
    (account ? this.api.update(account.id, name, apiKey) : this.api.add(name, apiKey)).subscribe({
      next: (a) => this.done(a),
      error: (e: unknown) => {
        this.saving.set(false);
        const refused = fieldErrors(e);
        if (refused) {
          this.error.set(null);
          this.errors.set(refused);
        } else {
          this.error.set('Could not save the TomTom account. Try again.');
        }
      },
    });
  }

  protected remove(account: TomTomAccount) {
    this.api.remove(account.id).subscribe({ next: (a) => this.done(a), error: () => this.error.set('Could not remove the TomTom account. Try again.') });
  }
}
