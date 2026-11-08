import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

/** An account as the select lists it: a Homey or a Plex account. */
export interface AccountOption {
  accountId: number;
  accountName: string;
}

/**
 * A select of accounts. `selected` is the account that is in use; an account that isn't among `accounts` (one that
 * was removed) shows as "Account removed" until another is picked. Give it an `id` for a visible label to point at, or
 * an `ariaLabel` when there is none.
 */
@Component({
  selector: 'hd-account-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <select
      class="hd-select"
      [id]="selectId()"
      [attr.aria-label]="ariaLabel()"
      (change)="picked.emit(+$any($event.target).value)"
    >
      @if (!found()) {
        <option value="" selected>Account removed</option>
      }
      @for (account of accounts(); track account.accountId) {
        <option
          [value]="account.accountId"
          [selected]="account.accountId === selected()"
        >
          {{ account.accountName }}
        </option>
      }
    </select>
  `,
})
export class AccountSelect {
  readonly accounts = input.required<readonly AccountOption[]>();
  readonly selected = input<number | undefined>();
  readonly selectId = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly picked = output<number>();

  protected found() {
    return this.accounts().some((a) => a.accountId === this.selected());
  }
}
