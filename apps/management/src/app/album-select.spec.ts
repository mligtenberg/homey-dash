import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ImmichAccount, ImmichAlbum } from '@homey-dash/api-client';
import { AlbumSelect } from './album-select';
import { AlbumGroup } from './immich-albums';

const group = (id: number, name: string): AlbumGroup => ({
  account: { id, name } as ImmichAccount,
  albums: [{ id: 'a', name: 'Summer', assetCount: 13 } as ImmichAlbum],
});

@Component({
  imports: [AlbumSelect],
  template: `<hd-album-select
    selectId="s"
    [groups]="groups"
    placeholder="Pick"
    (picked)="picks.push($event)"
  />`,
})
class Host {
  groups = [group(1, 'Home')];
  picks: string[] = [];
}

describe('AlbumSelect', () => {
  async function render(groups: AlbumGroup[]) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.groups = groups;
    await fixture.whenStable();
    return fixture;
  }

  it('lists albums flat for one account and emits the picked value', async () => {
    const fixture = await render([group(1, 'Home')]);
    const select = fixture.nativeElement.querySelector(
      'select',
    ) as HTMLSelectElement;
    expect(select.querySelector('optgroup')).toBeNull();
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
      'Pick',
      'Summer (13)',
    ]);
    select.value = '1:a';
    select.dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.picks).toEqual(['1:a']);
  });

  it('groups albums by account when there are several', async () => {
    const fixture = await render([group(1, 'Home'), group(2, 'Anna')]);
    expect(fixture.nativeElement.querySelectorAll('optgroup').length).toBe(2);
  });
});
