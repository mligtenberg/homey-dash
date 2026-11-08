import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountSelect } from './account-select';

@Component({
  imports: [AccountSelect],
  template: `<hd-account-select
    [accounts]="accounts"
    [selected]="selected"
    (picked)="picks.push($event)"
  />`,
})
class Host {
  accounts = [
    { accountId: 1, accountName: 'Home' },
    { accountId: 2, accountName: 'Cabin' },
  ];
  selected: number | undefined = 2;
  picks: number[] = [];
}

describe('AccountSelect', () => {
  async function render(selected: number | undefined) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.selected = selected;
    await fixture.whenStable();
    return {
      fixture,
      select: fixture.nativeElement.querySelector(
        'select',
      ) as HTMLSelectElement,
    };
  }

  it('selects the account in use and emits the picked id', async () => {
    const { fixture, select } = await render(2);
    expect(select.selectedOptions[0].textContent?.trim()).toBe('Cabin');
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.picks).toEqual([1]);
  });

  it('shows a removed account as such', async () => {
    const { select } = await render(9);
    expect(select.selectedOptions[0].textContent?.trim()).toBe(
      'Account removed',
    );
  });
});
