import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReorderButtons } from './reorder-buttons';

@Component({
  imports: [ReorderButtons],
  template: `<hd-reorder-buttons label="rule 2" [first]="first()" [last]="last()" [removable]="removable()" (moved)="moves.push($event)" (removed)="removals = removals + 1" />`,
})
class Host {
  readonly first = signal(false);
  readonly last = signal(false);
  readonly removable = signal(true);
  moves: number[] = [];
  removals = 0;
}

describe('ReorderButtons', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const button = (label: string) => fixture.nativeElement.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
    return { fixture, host: fixture.componentInstance, button };
  }

  it('moves and removes the item it names', async () => {
    const { host, button } = await render();
    button('Move rule 2 up')?.click();
    button('Move rule 2 down')?.click();
    button('Remove rule 2')?.click();
    expect(host.moves).toEqual([-1, 1]);
    expect(host.removals).toBe(1);
  });

  it("can't move the first item up or the last down, and leaves out remove when it can't be removed", async () => {
    const { fixture, host, button } = await render();
    host.first.set(true);
    host.last.set(true);
    host.removable.set(false);
    await fixture.whenStable();
    expect(button('Move rule 2 up')?.disabled).toBe(true);
    expect(button('Move rule 2 down')?.disabled).toBe(true);
    expect(button('Remove rule 2')).toBeNull();
  });
});
