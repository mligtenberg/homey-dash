import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

/**
 * The state of pages that swipe and snap in a scroller: which page shows, following the scroll, and a way to go to
 * one. `scroller` gives the scrolling element, which is absent until it renders.
 */
export function pager(scroller: () => HTMLElement | undefined) {
  const current = signal(0);
  return {
    current,
    /** Call on the scroller's `scroll`. */
    onScroll() {
      const el = scroller();
      if (el && el.clientWidth > 0) current.set(Math.round(el.scrollLeft / el.clientWidth));
    },
    go(page: number) {
      const el = scroller();
      el?.scrollTo({ left: page * el.clientWidth, behavior: 'smooth' });
    },
  };
}

/** A dot per page, the current one marked; give it the class of the strip it sits in. */
@Component({
  selector: 'hd-page-dots',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (_ of dots(); track $index) {
      <button type="button" class="hd-page-dot" [attr.aria-label]="labelOf()($index)" [attr.aria-current]="$index === current() || null" (click)="picked.emit($index)"></button>
    }
  `,
})
export class PageDots {
  readonly count = input.required<number>();
  readonly current = input.required<number>();
  /** The accessible name of the button for a page. */
  readonly labelOf = input.required<(page: number) => string>();
  readonly picked = output<number>();

  protected dots() {
    return Array.from({ length: this.count() });
  }
}
