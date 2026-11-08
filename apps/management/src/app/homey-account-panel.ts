import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HomeyAccountApi, HomeyStatus } from '@homey-dash/api-client';
import { AddressKeyForm, addressKeyAccounts } from './address-key-accounts';
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
  imports: [NgTemplateOutlet, AddressKeyForm],
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
      <hd-address-key-form
        idPrefix="homey"
        [account]="account"
        namePlaceholder="Such as Home or Holiday home"
        addressPlaceholder="192.168.1.10 or homey-….local"
        keyLabel="Local API key"
        keyHint="Make one in the Homey web app under Settings → API keys."
        addLabel="Add Homey"
        [saving]="saving()"
        [errors]="errors()"
        (saved)="save(account, $event)"
        (cancelled)="edit(null)"
      />
    </ng-template>
  `,
})
export class HomeyAccountPanel {
  private readonly homeys = inject(RealtimeTileData).homeys;
  private readonly accounts = addressKeyAccounts(inject(HomeyAccountApi), 'Homey');
  protected readonly info = this.accounts.info;
  /** Each Homey's connection, by account. */
  protected readonly statuses = computed(() => new Map((this.homeys() ?? []).map((h) => [h.accountId, h.status])));
  protected readonly statusPill = homeyStatusPill;
  /** The account whose form is open, 'new' while adding one. */
  protected readonly editing = this.accounts.editing;
  protected readonly removing = this.accounts.removing;
  protected readonly errors = this.accounts.errors;
  protected readonly error = this.accounts.error;
  protected readonly saving = this.accounts.saving;
  protected readonly edit = this.accounts.edit;
  protected readonly save = this.accounts.save;
  protected readonly remove = this.accounts.remove;
}
