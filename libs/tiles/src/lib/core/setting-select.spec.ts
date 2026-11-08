import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SettingSelect } from './setting-select';

@Component({
  imports: [SettingSelect],
  template: `<hd-setting-select label="Shows" selectId="s" emptyLabel="Automatic" [options]="options" [value]="value" (picked)="picks.push($event)" />`,
})
class Host {
  options = [
    { value: 'a', label: 'Alpha' },
    { value: 5, label: 'Five' },
  ];
  value: string | number | undefined = 5;
  picks: string[] = [];
}

describe('SettingSelect', () => {
  async function render(value: string | number | undefined) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.value = value;
    await fixture.whenStable();
    return { fixture, select: fixture.nativeElement.querySelector('select') as HTMLSelectElement };
  }

  it('labels the select, selects the value and emits what is picked', async () => {
    const { fixture, select } = await render(5);
    expect(fixture.nativeElement.querySelector('label').getAttribute('for')).toBe('s');
    expect(select.selectedOptions[0].textContent?.trim()).toBe('Five');
    select.value = 'a';
    select.dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.picks).toEqual(['a']);
  });

  it('selects the empty option while there is no value', async () => {
    const { select } = await render(undefined);
    expect(select.selectedOptions[0].textContent?.trim()).toBe('Automatic');
  });
});
