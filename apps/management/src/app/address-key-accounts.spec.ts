import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { AddressKeyAccount, addressKeyAccounts, AddressKeyAccounts } from './address-key-accounts';

type Info = AddressKeyAccounts<AddressKeyAccount>;

const one: Info = { fake: false, accounts: [{ id: 1, name: 'Home', address: '10.0.0.2' }] };
const two: Info = { fake: false, accounts: [...one.accounts, { id: 2, name: 'Cabin', address: '10.0.0.3' }] };

function api(answer: () => Observable<Info>) {
  return {
    calls: [] as string[],
    list: () => of(one),
    add(name: string, address: string, apiKey: string) {
      this.calls.push(`add ${name} ${address} ${apiKey}`);
      return answer();
    },
    update(id: number, name: string, address: string, apiKey: string) {
      this.calls.push(`update ${id} ${name} ${address} ${apiKey}`);
      return answer();
    },
    remove(id: number) {
      this.calls.push(`remove ${id}`);
      return answer();
    },
  };
}

describe('addressKeyAccounts', () => {
  it('loads the accounts, and closes the form once one is added', () => {
    const fake = api(() => of(two));
    const accounts = addressKeyAccounts(fake, 'Homey');
    expect(accounts.info()).toEqual(one);

    accounts.edit('new');
    accounts.save(null, { name: 'Cabin', address: '10.0.0.3', apiKey: 'key' });

    expect(fake.calls).toEqual(['add Cabin 10.0.0.3 key']);
    expect(accounts.info()).toEqual(two);
    expect(accounts.editing()).toBeNull();
    expect(accounts.saving()).toBe(false);
  });

  it('shows what the API refused per field, and keeps the form open', () => {
    const refused = new HttpErrorResponse({ status: 400, error: { errors: { address: ['Homey did not answer there.'] } } });
    const accounts = addressKeyAccounts(api(() => throwError(() => refused)), 'Homey');
    accounts.edit(1);
    accounts.save(one.accounts[0], { name: 'Home', address: '10.0.0.9', apiKey: '' });

    expect(accounts.errors()).toEqual({ address: 'Homey did not answer there.' });
    expect(accounts.error()).toBeNull();
    expect(accounts.editing()).toBe(1);
  });

  it('says it could not when the API fails otherwise', () => {
    const accounts = addressKeyAccounts(api(() => throwError(() => new HttpErrorResponse({ status: 500 }))), 'Immich');
    accounts.remove(one.accounts[0]);
    expect(accounts.error()).toBe('Could not remove the Immich account. Try again.');
  });
});
