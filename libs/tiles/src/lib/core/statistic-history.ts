import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, linkedSignal, signal, viewChild } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { HomeyApi, HomeyInsightEntry, HomeyInsightLog, InsightResolution } from '@homey-dash/api-client';
import { LucideChevronLeft, LucideChevronRight, LucideDynamicIcon } from '@lucide/angular';
import { formatReading } from './device-look';
import {
  STATISTIC_WINDOWS,
  StatisticChart,
  statisticFigures,
  statisticStamp,
  statisticTone,
} from './statistic-chart';

const WINDOWS = Object.entries(STATISTIC_WINDOWS).map(([id, { tab }]) => ({ id: id as InsightResolution, tab }));

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

/**
 * The history of what a device measures, as a page of its detail view: the value, a chart to scrub along, and
 * the lowest, highest, average and change under it. A device with several logs (temperature and humidity) picks
 * between them; a tab picks the time window. It fetches only while it is on screen, and it is the pane itself, so
 * the detail view gives it the statistic's full-screen look.
 */
@Component({
  selector: 'hd-statistic-history',
  imports: [StatisticChart, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-stat__pane hd-hist', '[attr.data-tone]': 'tone()' },
  template: `
    @if (logs().length > 1) {
      <div class="hd-hist__readings">
        @if (overflow()) {
          <button type="button" class="hd-round-btn" aria-label="Earlier readings" [disabled]="!edges().start" (click)="step(-1)">
            <svg [lucideIcon]="previousIcon" />
          </button>
        }
        <div
          #strip
          class="hd-segmented hd-hist__strip"
          role="group"
          aria-label="Reading"
          [class.has-start]="edges().start"
          [class.has-end]="edges().end"
          (scroll)="measure()"
        >
          @for (l of logs(); track l.id) {
            <button type="button" [attr.aria-pressed]="l.id === log().id" (click)="logId.set(l.id)">{{ l.title }}</button>
          }
        </div>
        @if (overflow()) {
          <button type="button" class="hd-round-btn" aria-label="More readings" [disabled]="!edges().end" (click)="step(1)">
            <svg [lucideIcon]="nextIcon" />
          </button>
        }
      </div>
    }
    <div class="hd-hist__bar">
      <div class="hd-segmented" role="group" aria-label="Time window">
        @for (w of windows; track w.id) {
          <button type="button" [attr.aria-pressed]="window() === w.id" (click)="window.set(w.id)">{{ w.tab }}</button>
        }
      </div>
    </div>
    @if (readout(); as readout) {
      <div class="hd-stat__readout">
        <div class="hd-value hd-value--xl">{{ readout.value }}<span class="hd-unit">{{ readout.units }}</span></div>
        <div class="hd-details__label">{{ pickedAt() ?? 'Now' }}</div>
      </div>
    }
    <hd-statistic-chart [entries]="entries()" [window]="windowInfo()" [scrub]="true" (picked)="picked.set($event)" />
    @if (!history.isLoading() && entries().length === 0) {
      <div class="hd-details__label">No history for this window</div>
    }
    @if (figures(); as figures) {
      <dl class="hd-stat__figures">
        @for (f of figures; track f.label) {
          <div class="hd-stat__figure">
            <dt class="hd-details__label">{{ f.label }}</dt>
            <dd class="hd-stat__figure-value">{{ f.value }}</dd>
            @if (f.note) {
              <dd class="hd-stat__figure-note">{{ f.note }}</dd>
            }
          </div>
        }
      </dl>
    }
  `,
})
export class StatisticHistory {
  private readonly homeyApi = inject(HomeyApi);

  /** The logs of the device, at least one. */
  readonly logs = input.required<readonly HomeyInsightLog[]>();
  readonly account = input<number>();
  /** The log it opens on; the first when absent or not among them. */
  readonly initial = input<string>();
  /** The time window it opens on. */
  readonly initialWindow = input<InsightResolution>('last24Hours');

  protected readonly windows = WINDOWS;
  protected readonly previousIcon = LucideChevronLeft;
  protected readonly nextIcon = LucideChevronRight;
  private readonly strip = viewChild<ElementRef<HTMLElement>>('strip');
  /** Whether the readings run past the edges of their strip, and on which side there is more. */
  protected readonly edges = signal({ start: false, end: false });
  protected readonly overflow = computed(() => this.edges().start || this.edges().end);
  protected readonly window = linkedSignal<InsightResolution>(() => this.initialWindow());
  protected readonly logId = linkedSignal<string | undefined>(() => this.initial());
  protected readonly picked = signal<HomeyInsightEntry | null>(null);

  protected readonly log = computed(() => this.logs().find((l) => l.id === this.logId()) ?? this.logs()[0]);
  protected readonly windowInfo = computed(() => STATISTIC_WINDOWS[this.window()]);
  protected readonly tone = computed(() => statisticTone(this.log()));

  protected readonly history = rxResource({
    params: () => ({ log: this.log().id, window: this.window(), account: this.account() }),
    stream: ({ params }) => this.homeyApi.insightEntries(params.log, params.window, params.account),
  });
  protected readonly entries = computed<readonly HomeyInsightEntry[]>(() => (this.history.hasValue() ? this.history.value() : []));

  protected readonly readout = computed(() => {
    const entry = this.picked() ?? [...this.entries()].reverse().find((e) => e.v !== null);
    return entry ? formatReading(entry.v as number, this.log().units) : null;
  });
  protected readonly pickedAt = computed(() => {
    const picked = this.picked();
    return picked ? statisticStamp(picked.t, this.windowInfo().ms) : null;
  });
  protected readonly figures = computed(() => statisticFigures(this.entries(), this.windowInfo(), this.log().units));

  constructor() {
    effect((onCleanup) => {
      const element = this.strip()?.nativeElement;
      if (!element || typeof ResizeObserver === 'undefined') return;
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

  /** Scrolls the readings a step in a direction, to where the item that was cut off sits at that edge. */
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
