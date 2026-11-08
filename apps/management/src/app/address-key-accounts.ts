import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { fieldErrors } from '@homey-dash/api-client';
import { Observable } from 'rxjs';

/** An account of a service HomeyDash reaches at an address with an API key, such as a Homey Pro or an Immich server. */
export interface AddressKeyAccount {
  id: number;
  name: string;
  address: string;
}

/** What the API answers every change with: all the accounts, and whether HomeyDash runs against a fake of the service. */
export interface AddressKeyAccounts<T extends AddressKeyAccount> {
  fake: boolean;
  accounts: T[];
}

/** The API of such accounts, as `HomeyAccountApi` and `ImmichAccountApi` offer it. */
export interface AddressKeyAccountApi<T extends AddressKeyAccount, I extends AddressKeyAccounts<T>> {
  list(): Observable<I>;
  add(name: string, address: string, apiKey: string): Observable<I>;
  update(id: number, name: string, address: string, apiKey: string): Observable<I>;
  remove(id: number): Observable<I>;
}

export interface AddressKeyValues {
  name: string;
  address: string;
  apiKey: string;
}

/**
 * The state of a panel of such accounts: the accounts, the one whose form is open (`new` while adding one), the one
 * being removed, and what went wrong: per field when the API refused the form, else as a whole. Loads them at once.
 * `noun` names an account in errors, such as "Homey".
 */
export function addressKeyAccounts<T extends AddressKeyAccount, I extends AddressKeyAccounts<T>>(api: AddressKeyAccountApi<T, I>, noun: string) {
  const info = signal<I | null>(null);
  const editing = signal<number | 'new' | null>(null);
  const removing = signal<number | null>(null);
  const errors = signal<Record<string, string>>({});
  const error = signal<string | null>(null);
  const saving = signal(false);

  const edit = (which: number | 'new' | null) => {
    editing.set(which);
    removing.set(null);
    errors.set({});
    error.set(null);
  };
  const done = (answer: I) => {
    info.set(answer);
    saving.set(false);
    edit(null);
  };
  const fail = (what: string) => error.set(`Could not ${what} the ${noun} account. Try again.`);

  api.list().subscribe({ next: done, error: () => fail('load') });

  return {
    info: info.asReadonly(),
    editing: editing.asReadonly(),
    removing,
    errors: errors.asReadonly(),
    error: error.asReadonly(),
    saving: saving.asReadonly(),
    edit,
    save(account: T | null, { name, address, apiKey }: AddressKeyValues) {
      saving.set(true);
      const request = account ? api.update(account.id, name, address, apiKey) : api.add(name, address, apiKey);
      request.subscribe({
        next: done,
        error: (e: unknown) => {
          saving.set(false);
          const refused = fieldErrors(e);
          if (refused) {
            error.set(null);
            errors.set(refused);
          } else {
            fail('save');
          }
        },
      });
    },
    remove(account: T) {
      api.remove(account.id).subscribe({ next: done, error: () => fail('remove') });
    },
  };
}

/** The form that adds or changes such an account: its name, address and API key, with what the API said is wrong. */
@Component({
  selector: 'hd-address-key-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <form class="form" (submit)="submit($event, name.value, address.value, apiKey.value)">
      <div class="hd-field">
        <label class="hd-field__label" [for]="idPrefix() + '-name'">Name</label>
        <input
          #name
          [id]="idPrefix() + '-name'"
          class="hd-input"
          autocomplete="off"
          [placeholder]="namePlaceholder()"
          [value]="account()?.name ?? ''"
          [attr.aria-invalid]="!!errors()['name']"
          [attr.aria-describedby]="idPrefix() + '-name-error'"
        />
        @if (errors()['name']; as error) {
          <span [id]="idPrefix() + '-name-error'" class="hd-error hd-small">{{ error }}</span>
        }
      </div>
      <div class="hd-field">
        <label class="hd-field__label" [for]="idPrefix() + '-address'">Address</label>
        <input
          #address
          [id]="idPrefix() + '-address'"
          class="hd-input"
          autocomplete="off"
          [placeholder]="addressPlaceholder()"
          [value]="account()?.address ?? ''"
          [attr.aria-invalid]="!!errors()['address']"
          [attr.aria-describedby]="idPrefix() + '-address-error'"
        />
        @if (errors()['address']; as error) {
          <span [id]="idPrefix() + '-address-error'" class="hd-error hd-small">{{ error }}</span>
        }
      </div>
      <div class="hd-field">
        <label class="hd-field__label" [for]="idPrefix() + '-key'">{{ keyLabel() }}</label>
        <input
          #apiKey
          [id]="idPrefix() + '-key'"
          class="hd-input"
          type="password"
          autocomplete="off"
          [placeholder]="account() ? 'Leave empty to keep the current key' : ''"
          [attr.aria-invalid]="!!errors()['apiKey']"
          [attr.aria-describedby]="idPrefix() + '-key-hint'"
        />
        <span [id]="idPrefix() + '-key-hint'" [class]="errors()['apiKey'] ? 'hd-error hd-small' : 'hd-hint'">
          {{ errors()['apiKey'] ?? keyHint() }}
        </span>
      </div>
      <div class="hd-actions">
        <button class="hd-btn hd-btn--primary" type="submit" [disabled]="saving()">
          {{ saving() && checkingLabel() ? checkingLabel() : account() ? 'Save' : addLabel() }}
        </button>
        <button class="hd-btn" type="button" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: var(--space-4); flex: 1; }
  `,
})
export class AddressKeyForm {
  /** Starts the ids of its fields, such as `homey`; one per page. */
  readonly idPrefix = input.required<string>();
  /** The account it changes; null adds one. */
  readonly account = input.required<AddressKeyAccount | null>();
  readonly namePlaceholder = input('');
  readonly addressPlaceholder = input('');
  readonly keyLabel = input('API key');
  readonly keyHint = input('');
  /** The button that adds an account, such as "Add Homey". */
  readonly addLabel = input.required<string>();
  /** What the button says while the API checks the account, if it does. */
  readonly checkingLabel = input<string | null>(null);
  readonly saving = input(false);
  readonly errors = input<Record<string, string>>({});
  readonly saved = output<AddressKeyValues>();
  readonly cancelled = output<void>();

  protected submit(event: Event, name: string, address: string, apiKey: string) {
    event.preventDefault();
    this.saved.emit({ name, address, apiKey });
  }
}
