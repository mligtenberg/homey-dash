import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmInline } from './confirm-inline';

@Component({
  imports: [ConfirmInline],
  template: `<hd-confirm-inline message="Its tiles show as missing." (confirmed)="confirmed = confirmed + 1" (cancelled)="cancelled = cancelled + 1" />`,
})
class Host {
  confirmed = 0;
  cancelled = 0;
}

describe('ConfirmInline', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    return { fixture, buttons };
  }

  it('says what removing does, with Remove and Cancel', async () => {
    const { fixture, buttons } = await setup();
    expect(fixture.nativeElement.textContent).toContain('Its tiles show as missing.');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Remove', 'Cancel']);
  });

  it('emits the answer', async () => {
    const { fixture, buttons } = await setup();
    buttons[0].click();
    buttons[1].click();
    buttons[1].click();
    expect(fixture.componentInstance.confirmed).toBe(1);
    expect(fixture.componentInstance.cancelled).toBe(2);
  });
});
