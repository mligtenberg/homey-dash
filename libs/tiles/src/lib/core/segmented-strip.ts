import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { LucideChevronLeft, LucideChevronRight } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';

/**
 * Where a strip of items scrolls to when an arrow is tapped, so the item cut off on that side comes fully into view
 * as far along as it can go: to the right, the first item cut off at the right edge moves to the left edge, but not
 * beyond the end of the strip; to the left, the last item cut off at the left edge moves to the right edge, but not
 * before the start. `items` are in the strip's own coordinates. Null when nothing is cut off that way.
 */
export function stripTarget(
  items: readonly { left: number; right: number }[],
  scrollLeft: number,
  width: number,
  scrollWidth: number,
  direction: 1 | -1,
): number | null {
  const max = Math.max(0, scrollWidth - width);
  // An item wider than the view is cut off wherever it is; it only counts when moving would show more of the strip.
  if (direction > 0) {
    const targets = items.filter((i) => i.right > scrollLeft + width + 0.5).map((i) => Math.min(i.left, max));
    return targets.find((t) => t > scrollLeft + 0.5) ?? null;
  }
  const targets = items.filter((i) => i.left < scrollLeft - 0.5).map((i) => Math.max(0, i.right - width)).reverse();
  return targets.find((t) => t < scrollLeft - 0.5) ?? null;
}

/** One choice of a `SegmentedStrip`; `marked` puts a dot before its label, such as for something live. */
export interface StripOption<T> {
  id: T;
  label: string;
  marked?: boolean;
}

/**
 * A row of choices of which one is pressed, like `hd-segmented`, for more choices than fit: it scrolls sideways, an
 * item cut off by an edge fades out there, and arrows move it an item at a time once it overflows. Used for the
 * readings of a device and the sections of NOS's news.
 */
@Component({
  selector: 'hd-segmented-strip',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-strip' },
  template: `
    @if (overflow()) {
      <button type="button" class="hd-round-btn" aria-label="Earlier" [disabled]="!edges().start" (click)="step(-1)">
        <svg [lucideIcon]="previousIcon" />
      </button>
    }
    <div
      #strip
      class="hd-segmented hd-strip__scroll"
      role="group"
      [attr.aria-label]="label()"
      [class.has-start]="edges().start"
      [class.has-end]="edges().end"
      (scroll)="measure()"
    >
      @for (o of options(); track o.id) {
        <button type="button" [attr.aria-pressed]="o.id === value()" (click)="picked.emit(o.id)">
          @if (o.marked) {
            <span class="hd-strip__mark" aria-hidden="true"></span>
          }
          {{ o.label }}
        </button>
      }
    </div>
    @if (overflow()) {
      <button type="button" class="hd-round-btn" aria-label="More" [disabled]="!edges().end" (click)="step(1)">
        <svg [lucideIcon]="nextIcon" />
      </button>
    }
  `,
})
export class SegmentedStrip<T> {
  readonly options = input.required<readonly StripOption<T>[]>();
  readonly value = input.required<T>();
  /** What the group is called, for assistive technology. */
  readonly label = input.required<string>();
  readonly picked = output<T>();

  protected readonly previousIcon = LucideChevronLeft;
  protected readonly nextIcon = LucideChevronRight;
  private readonly strip = viewChild<ElementRef<HTMLElement>>('strip');
  /** Whether the items run past the edges of the strip, and on which side there is more. */
  protected readonly edges = signal({ start: false, end: false });
  protected readonly overflow = computed(() => this.edges().start || this.edges().end);

  constructor() {
    effect((onCleanup) => {
      const element = this.strip()?.nativeElement;
      if (!element || typeof ResizeObserver === 'undefined') return;
      this.options(); // Measures again when the items change.
      const observer = new ResizeObserver(() => this.measure());
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });
  }

  protected measure() {
    const element = this.strip()?.nativeElement;
    if (!element) return;
    const start = element.scrollLeft > 1;
    const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    const now = this.edges();
    if (start !== now.start || end !== now.end) this.edges.set({ start, end });
  }

  /** Scrolls the items a step in a direction, to where the item that was cut off sits at that edge. */
  protected step(direction: 1 | -1) {
    const element = this.strip()?.nativeElement;
    if (!element) return;
    const origin = element.getBoundingClientRect().left - element.scrollLeft;
    const items = [...element.querySelectorAll('button')].map((b) => {
      const box = b.getBoundingClientRect();
      return { left: box.left - origin, right: box.right - origin };
    });
    const target = stripTarget(items, element.scrollLeft, element.clientWidth, element.scrollWidth, direction);
    if (target !== null) element.scrollTo({ left: target, behavior: 'smooth' });
  }
}
