import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PageDots, pager } from './pager';

describe('pager', () => {
  it('follows the scroll and scrolls to a page', () => {
    const el = { clientWidth: 200, scrollLeft: 0, scrollTo: vi.fn() } as unknown as HTMLElement;
    const p = pager(() => el);
    el.scrollLeft = 410;
    p.onScroll();
    expect(p.current()).toBe(2);
    p.go(1);
    expect(el.scrollTo).toHaveBeenCalledWith({ left: 200, behavior: 'smooth' });
  });

  it('copes with a scroller that has not rendered', () => {
    const p = pager(() => undefined);
    p.onScroll();
    p.go(1);
    expect(p.current()).toBe(0);
  });
});

@Component({
  imports: [PageDots],
  template: `<hd-page-dots [count]="3" [current]="1" [labelOf]="label" (picked)="picks.push($event)" />`,
})
class Host {
  picks: number[] = [];
  label = (page: number) => `Page ${page + 1}`;
}

describe('PageDots', () => {
  it('marks the current page and picks another', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const dots = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual(['Page 1', 'Page 2', 'Page 3']);
    expect(dots.map((d) => d.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    dots[2].click();
    expect(fixture.componentInstance.picks).toEqual([2]);
  });
});
