import { AccountPanel } from './account-panel';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ImmichAccountApi } from '@homey-dash/api-client';
import { AddressKeyForm, addressKeyAccounts } from './address-key-accounts';
import { ImmichPartners } from './immich-partners';

/**
 * The Immich accounts, whose albums photo sets follow: each a name, the server's address and an API key made in
 * Immich, such as one per person's Immich. HomeyDash checks the address and key with Immich before keeping them.
 * Removing one keeps its photo sets, but displays can't fetch their photos until each set is given another account.
 * Under each, the partners who share their photos with it, who can be given a key of their own to rotate them.
 */
@Component({
  selector: 'hd-immich-account-panel',
  imports: [AccountPanel, NgTemplateOutlet, AddressKeyForm, ImmichPartners],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-account-panel key="immich" title="Immich" [error]="error()">
      <ng-container ngProjectAs="[status]">
        @if (info(); as info) {
          @if (info.fake) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Fake Immich</span>
          } @else if (info.accounts.length) {
            <span class="hd-pill hd-pill--ok hd-pill--dot">Set up</span>
          } @else {
            <span class="hd-pill hd-pill--warn hd-pill--dot">Not set up</span>
          }
        }
      </ng-container>
      @if (info(); as info) {
        @if (info.fake) {
          <p class="hd-muted">
            HomeyDash runs against a fake Immich with sample albums, set in its
            configuration.
          </p>
          @for (account of info.accounts; track account.id) {
            <div class="hd-account__item">
              <hd-immich-partners [account]="account" />
            </div>
          }
        } @else {
          <p class="hd-muted">
            Photo sets follow albums in Immich. Add an account for each Immich
            server, or for each person whose photos you want to show. Displays
            get their photos through HomeyDash, so only HomeyDash needs to reach
            Immich.
          </p>
          @for (account of info.accounts; track account.id) {
            <div class="hd-account__item">
              @if (editing() === account.id) {
                <ng-container
                  *ngTemplateOutlet="form; context: { $implicit: account }"
                />
              } @else {
                <div class="hd-account__info">
                  <strong>{{ account.name }}</strong>
                  <span class="hd-muted">{{ account.address }}</span>
                </div>
                <div class="hd-actions">
                  @if (removing() === account.id) {
                    <span class="hd-muted"
                      >Its photo sets stay, but displays can't show their photos
                      until you give them another account.</span
                    >
                    <button
                      class="hd-btn hd-btn--danger"
                      type="button"
                      (click)="remove(account)"
                    >
                      Remove
                    </button>
                    <button
                      class="hd-btn"
                      type="button"
                      (click)="removing.set(null)"
                    >
                      Cancel
                    </button>
                  } @else {
                    <button
                      class="hd-btn"
                      type="button"
                      (click)="edit(account.id)"
                    >
                      Edit
                    </button>
                    <button
                      class="hd-btn hd-btn--danger"
                      type="button"
                      (click)="removing.set(account.id)"
                    >
                      Remove
                    </button>
                  }
                </div>
                <hd-immich-partners [account]="account" />
              }
            </div>
          }
          @if (editing() === 'new') {
            <div class="hd-account__item">
              <ng-container
                *ngTemplateOutlet="form; context: { $implicit: null }"
              />
            </div>
          } @else if (editing() === null) {
            <div class="hd-actions">
              <button
                class="hd-btn"
                [class.hd-btn--primary]="!info.accounts.length"
                type="button"
                (click)="edit('new')"
              >
                {{
                  info.accounts.length
                    ? 'Add another Immich account'
                    : 'Set up Immich'
                }}
              </button>
            </div>
          }
        }
      }
    </hd-account-panel>

    <ng-template #form let-account>
      <hd-address-key-form
        idPrefix="immich"
        [account]="account"
        namePlaceholder="Such as Home or Anna's photos"
        addressPlaceholder="192.168.1.20:2283 or https://photos.example.com"
        keyHint="Make one in Immich under Account Settings → API Keys, with at least album.read, asset.read, asset.view, face.read and person.read."
        addLabel="Add account"
        checkingLabel="Checking with Immich…"
        [saving]="saving()"
        [errors]="errors()"
        (saved)="save(account, $event)"
        (cancelled)="edit(null)"
      />
    </ng-template>
  `,
})
export class ImmichAccountPanel {
  private readonly accounts = addressKeyAccounts(
    inject(ImmichAccountApi),
    'Immich',
  );
  protected readonly info = this.accounts.info;
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
