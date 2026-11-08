import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Transport } from './transport';

@Component({
  imports: [Transport],
  template: `<hd-transport class="strip" playClass="big" [playing]="playing()" [previous]="previous()" [disabled]="disabled()" (toggled)="events.push('toggle')" (skippedBack)="events.push('back')" (skippedForward)="events.push('next')" />`,
})
class Host {
  readonly playing = signal(false);
  readonly previous = signal(true);
  readonly disabled = signal(false);
  events: string[] = [];
}

describe('Transport', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const button = (label: string) => fixture.nativeElement.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
    return { fixture, host: fixture.componentInstance, button };
  }

  it('plays, skips and names the play button for what it does', async () => {
    const { fixture, host, button } = await render();
    button('Previous')?.click();
    button('Play')?.click();
    button('Next')?.click();
    expect(host.events).toEqual(['back', 'toggle', 'next']);
    expect(button('Play')?.classList.contains('big')).toBe(true);
    host.playing.set(true);
    await fixture.whenStable();
    expect(button('Pause')).not.toBeNull();
  });

  it('leaves out the skip it is told not to offer, and disables all', async () => {
    const { fixture, host, button } = await render();
    host.previous.set(false);
    host.disabled.set(true);
    await fixture.whenStable();
    expect(button('Previous')).toBeNull();
    expect(button('Play')?.disabled).toBe(true);
  });
});
