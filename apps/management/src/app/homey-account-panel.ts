import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { fieldErrors, HomeyAccount, HomeyAccountApi, HomeyAccounts, HomeyStatus } from '@homey-dash/api-client';
import { RealtimeTileData } from '@homey-dash/tiles';

/** How HomeyDash's connection to a Homey reads in a status pill. */
export function homeyStatusPill(status: HomeyStatus | undefined): { label: string; tone: 'ok' | 'warn' | 'danger' | '' } {
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
 * The Homey accounts: each a name, a Homey Pro's address on the local network and a local API key, such as one per
 * house. HomeyDash keeps connected to each. A Homey tile names its account; one that names none uses the oldest. Removing
 * an account leaves the tiles that name it missing until they are given another.
 */
@Component({
  selector: 'hd-homey-account-panel',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hd-account hd-panel" aria-labelledby="homey-title">
      <div class="hd-account__head">
        <h2 class="hd-panel__title" id="homey-title">Homey</h2>
        @if (info(); as info) {
          @if (!info.accounts.length) {
            <span class="hd-pill hd-pill--warn hd-pill--dot">Not set up</span>
          }
        }
      </div>
      @if (info(); as info) {
        @if (info.fake) {
          <p class="hd-muted">HomeyDash runs against a fake Homey with sample devices, set in its configuration.</p>
        } @else {
          <p class="hd-muted">
            Add each Homey Pro HomeyDash should control, such as one per house. Displays reach Homey through HomeyDash, so
            only HomeyDash needs to be on Homey's network.
          </p>
        }
        @for (account of info.accounts; track account.id) {
          @let status = statuses().get(account.id);
          @let pill = statusPill(status);
          <div class="hd-account__item">
            @if (editing() === account.id) {
              <ng-container *ngTemplateOutlet="form; context: { $implicit: account }" />
            } @else {
              <div class="hd-account__info">
                <strong>{{ account.name }}</strong>
                @if (!info.fake) {
                  <span class="hd-muted">{{ account.address }}</span>
                }
                @if (status?.connection === 'disconnected' && status?.lastError; as error) {
                  <span class="hd-muted hd-small" role="status">{{ error }}</span>
                }
              </div>
              <div class="hd-actions">
                <span class="hd-pill hd-pill--dot" [class]="pill.tone ? 'hd-pill--' + pill.tone : ''">{{ pill.label }}</span>
                @if (!info.fake) {
                  @if (removing() === account.id) {
                    <span class="hd-muted">Its tiles show as missing until you give them another Homey.</span>
                    <button class="hd-btn hd-btn--danger" type="button" (click)="remove(account)">Remove</button>
                    <button class="hd-btn" type="button" (click)="removing.set(null)">Cancel</button>
                  } @else {
                    <button class="hd-btn" type="button" (click)="edit(account.id)">Edit</button>
                    <button class="hd-btn hd-btn--danger" type="button" (click)="removing.set(account.id)">Remove</button>
                  }
                }
              </div>
            }
          </div>
        }
        @if (!info.fake) {
          @if (editing() === 'new') {
            <div class="hd-account__item">
              <ng-container *ngTemplateOutlet="form; context: { $implicit: null }" />
            </div>
          } @else if (editing() === null) {
            <div class="hd-actions">
              <button class="hd-btn" [class.hd-btn--primary]="!info.accounts.length" type="button" (click)="edit('new')">
                {{ info.accounts.length ? 'Add another Homey' : 'Set up Homey' }}
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
          <label class="hd-field__label" for="homey-name">Name</label>
          <input
            #name
            id="homey-name"
            class="hd-input"
            autocomplete="off"
            placeholder="Such as Home or Holiday home"
            [value]="account?.name ?? ''"
            [attr.aria-invalid]="!!errors()['name']"
            aria-describedby="homey-name-error"
          />
          @if (errors()['name']; as error) {
            <span id="homey-name-error" class="hd-error hd-small">{{ error }}</span>
          }
        </div>
        <div class="hd-field">
          <label class="hd-field__label" for="homey-address">Address</label>
          <input
            #address
            id="homey-address"
            class="hd-input"
            autocomplete="off"
            placeholder="192.168.1.10 or homey-….local"
            [value]="account?.address ?? ''"
            [attr.aria-invalid]="!!errors()['address']"
            aria-describedby="homey-address-error"
          />
          @if (errors()['address']; as error) {
            <span id="homey-address-error" class="hd-error hd-small">{{ error }}</span>
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
            [placeholder]="account ? 'Leave empty to keep the current key' : ''"
            [attr.aria-invalid]="!!errors()['apiKey']"
            aria-describedby="homey-key-hint"
          />
          <span id="homey-key-hint" [class]="errors()['apiKey'] ? 'hd-error hd-small' : 'hd-hint'">
            {{ errors()['apiKey'] ?? 'Make one in the Homey web app under Settings → API keys.' }}
          </span>
        </div>
        <div class="hd-actions">
          <button class="hd-btn hd-btn--primary" type="submit" [disabled]="saving()">{{ account ? 'Save' : 'Add Homey' }}</button>
          <button class="hd-btn" type="button" (click)="edit(null)">Cancel</button>
        </div>
      </form>
    </ng-template>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: var(--space-4); flex: 1; }
  `,
})
export class HomeyAccountPanel {
  private readonly api = inject(HomeyAccountApi);
  private readonly homeys = inject(RealtimeTileData).homeys;

  protected readonly info = signal<HomeyAccounts | null>(null);
  /** Each Homey's connection, by account. */
  protected readonly statuses = computed(() => new Map((this.homeys() ?? []).map((h) => [h.accountId, h.status])));
  protected readonly statusPill = homeyStatusPill;
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

  protected save(event: Event, account: HomeyAccount | null, name: string, address: string, apiKey: HTMLInputElement) {
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

  protected remove(account: HomeyAccount) {
    this.api.remove(account.id).subscribe({ next: (info) => this.done(info), error: () => this.fail('remove') });
  }

  private done(info: HomeyAccounts) {
    this.info.set(info);
    this.saving.set(false);
    this.edit(null);
  }

  private fail(what: string) {
    this.error.set(`Could not ${what} the Homey account. Try again.`);
  }
}
