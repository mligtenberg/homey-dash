import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountPanel } from './account-panel';

@Component({
  imports: [AccountPanel],
  template: `
    <hd-account-panel key="x" title="Thing" [error]="error()">
      <ng-container ngProjectAs="[status]"><span class="pill">Ok</span></ng-container>
      <p class="body">Body</p>
    </hd-account-panel>
  `,
})
class Host {
  readonly error = signal<string | null>(null);
}

describe('AccountPanel', () => {
  it('labels the panel by its title, puts the status in the header and shows the error last', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('section')?.getAttribute('aria-labelledby')).toBe('x-title');
    expect(el.querySelector('#x-title')?.textContent).toBe('Thing');
    expect(el.querySelector('.hd-account__head .pill')).not.toBeNull();
    expect(el.querySelector('[role=alert]')).toBeNull();
    fixture.componentInstance.error.set('Broke');
    await fixture.whenStable();
    expect(el.querySelector('section')?.lastElementChild?.textContent).toBe('Broke');
  });
});
