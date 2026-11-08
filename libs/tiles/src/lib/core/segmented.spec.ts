import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Segmented } from './segmented';

@Component({
  imports: [Segmented],
  template: `<hd-segmented label="Show" [options]="options" [value]="value()" [disabled]="disabled()" (picked)="value.set($event)" />`,
})
class Host {
  readonly options = [
    { id: 'a', label: 'First' },
    { id: 'b', label: 'Second' },
  ];
  readonly value = signal('a');
  readonly disabled = signal(false);
}

describe('Segmented', () => {
  it('presses the current option and picks another', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement.querySelector('hd-segmented') as HTMLElement;
    const buttons = [...el.querySelectorAll('button')];
    expect(el.classList.contains('hd-segmented')).toBe(true);
    expect(el.getAttribute('aria-label')).toBe('Show');
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    buttons[1].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('b');
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  });

  it('disables its buttons', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.disabled.set(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
  });
});
