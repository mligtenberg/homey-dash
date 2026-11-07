import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HomeyInsightEntry, HomeyInsightLog, InsightResolution } from '@homey-dash/api-client';
import { formatReading } from './device-look';

const HOUR = 3_600_000;

export const STATISTIC_WINDOWS: Record<
  InsightResolution,
  { label: string; tab: string; ago: string; ms: number }
> = {
  lastHour: { label: 'Last hour', tab: 'Hour', ago: '1h ago', ms: HOUR },
  last24Hours: {
    label: 'Last 24 hours',
    tab: 'Day',
    ago: '24h ago',
    ms: 24 * HOUR,
  },
  last7Days: {
    label: 'Last 7 days',
    tab: 'Week',
    ago: '7d ago',
    ms: 7 * 24 * HOUR,
  },
  last31Days: {
    label: 'Last 31 days',
    tab: 'Month',
    ago: '31d ago',
    ms: 31 * 24 * HOUR,
  },
};

/**
 * What a log measures, for the colour of its full-screen view: power and energy are amber like a lit lamp,
 * temperature warm, humidity cool. Anything else keeps the tile's own hue.
 */
export type StatisticTone = 'power' | 'temperature' | 'humidity' | 'other';

export function statisticTone(
  log: Pick<HomeyInsightLog, 'id' | 'units'> | undefined,
): StatisticTone {
  const units = log?.units ?? '';
  const id = log?.id ?? '';
  if (/power|meter|energy/.test(id) || /^(k?Wh?|A|V)$/.test(units))
    return 'power';
  if (/temperature/.test(id) || /^°/.test(units)) return 'temperature';
  if (/humidity/.test(id) || units === '%') return 'humidity';
  return 'other';
}

export interface StatisticSummary {
  lowest: HomeyInsightEntry;
  highest: HomeyInsightEntry;
  average: number;
  /** The first and last values of the window. */
  from: number;
  to: number;
}

/** The lowest, highest and average value of the `windowMs` up to the last entry, or null when it has none. */
export function summarize(
  entries: readonly HomeyInsightEntry[],
  windowMs: number,
): StatisticSummary | null {
  const values = entries.filter(
    (e): e is HomeyInsightEntry & { v: number } => e.v !== null,
  );
  if (values.length === 0) return null;
  const start = Date.parse(values[values.length - 1].t) - windowMs;
  const inWindow = values.filter((e) => Date.parse(e.t) >= start);
  const lowest = inWindow.reduce((a, b) => (b.v < a.v ? b : a));
  const highest = inWindow.reduce((a, b) => (b.v > a.v ? b : a));
  const average = inWindow.reduce((sum, e) => sum + e.v, 0) / inWindow.length;
  return {
    lowest,
    highest,
    average,
    from: inWindow[0].v,
    to: inWindow[inWindow.length - 1].v,
  };
}

/**
 * The device and capability a log records, from its id such as `homey:device:<id>:measure_power`. Homey's own
 * `energy_power` log is not a capability; it follows `measure_power`.
 */
export function logOwner(
  logId: string,
): { deviceId: string; capability: string } | null {
  const match = /^homey:device:([^:]+):(.+)$/.exec(logId);
  if (!match) return null;
  return {
    deviceId: match[1],
    capability: match[2] === 'energy_power' ? 'measure_power' : match[2],
  };
}

/** A time as the history shows it: with the day when the window is longer than one. */
export function statisticStamp(iso: string, windowMs: number): string {
  return new Date(iso).toLocaleString([], {
    ...(windowMs > 24 * HOUR
      ? { weekday: 'short', day: 'numeric', month: 'short' }
      : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The lowest, highest, average and change of a window, as the cards under a history show them; null without values. */
export function statisticFigures(
  entries: readonly HomeyInsightEntry[],
  window: { label: string; ms: number },
  units: string | null,
): { label: string; value: string; note: string }[] | null {
  const summary = summarize(entries, window.ms);
  if (!summary) return null;
  const show = (v: number) => {
    const { value, units: u } = formatReading(v, units);
    return `${value}${u}`;
  };
  const stamp = (iso: string) => statisticStamp(iso, window.ms);
  const change = summary.to - summary.from;
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  return [
    {
      label: 'Lowest',
      value: show(summary.lowest.v as number),
      note: stamp(summary.lowest.t),
    },
    {
      label: 'Highest',
      value: show(summary.highest.v as number),
      note: stamp(summary.highest.t),
    },
    { label: 'Average', value: show(summary.average), note: '' },
    {
      label: 'Change',
      value: `${sign}${show(Math.abs(change))}`,
      note: `over the ${window.label.toLowerCase()}`,
    },
  ];
}

export interface ChartPoint {
  x: number;
  y: number;
  entry: HomeyInsightEntry;
}

export interface Chart {
  line: string;
  area: string;
  /** Where the plot ends; the value labels go to the right of it. */
  right: number;
  points: ChartPoint[];
  dot: ChartPoint | null;
  grid: { y: number; label: string }[];
}

function niceStep(range: number) {
  const raw = range / 2;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const n = raw / magnitude;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * magnitude;
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * The chart's shapes in a `width` × `height` box: the window up to the last entry runs left to right, and the
 * values span round grid lines. The value labels take a gutter on the right of `charWidth` per character, so the
 * line never runs under them. A null value is a gap in the line.
 */
export function drawChart(
  entries: readonly HomeyInsightEntry[],
  windowMs: number,
  width: number,
  height: number,
  charWidth = 0,
): Chart {
  const values = entries.map((e) => e.v).filter((v): v is number => v !== null);
  if (values.length === 0)
    return {
      line: '',
      area: '',
      right: width,
      points: [],
      dot: null,
      grid: [],
    };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = niceStep(max - min || Math.abs(max) || 1);
  const low = Math.floor(min / step) * step;
  const high = Math.max(Math.ceil(max / step) * step, low + step);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const labels: string[] = [];
  for (let v = low; v <= high + step / 2; v += step)
    labels.push(v.toFixed(decimals));

  const right = round(
    width -
      (charWidth
        ? (Math.max(...labels.map((l) => l.length)) + 1) * charWidth
        : 0),
  );
  const top = height * 0.06;
  const bottom = height * 0.84; // Room below for the time labels.
  const end = Date.parse(entries[entries.length - 1].t);
  const x = (t: number) => round(((t - (end - windowMs)) / windowMs) * right);
  const y = (v: number) =>
    round(bottom - ((v - low) / (high - low)) * (bottom - top));

  const segments: ChartPoint[][] = [[]];
  for (const entry of entries) {
    const t = Date.parse(entry.t);
    if (t < end - windowMs) continue;
    if (entry.v === null) segments.push([]);
    else segments[segments.length - 1].push({ x: x(t), y: y(entry.v), entry });
  }
  const drawn = segments.filter((s) => s.length > 0);
  const path = (s: ChartPoint[]) =>
    s.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const points = drawn.flat();

  return {
    line: drawn.map(path).join(' '),
    area: drawn
      .map(
        (s) =>
          `M${s[0].x},${bottom} ${path(s).replace('M', 'L')} L${s[s.length - 1].x},${bottom} Z`,
      )
      .join(' '),
    right,
    points,
    dot: points[points.length - 1] ?? null,
    grid: labels.map((label, i) => ({ y: y(low + i * step), label })),
  };
}

/** The point nearest to `x` along the time axis. */
export function nearestPoint(
  points: readonly ChartPoint[],
  x: number,
): ChartPoint | null {
  let nearest: ChartPoint | null = null;
  for (const p of points)
    if (!nearest || Math.abs(p.x - x) < Math.abs(nearest.x - x)) nearest = p;
  return nearest;
}

/**
 * The chart of a statistic, drawn in its own pixels so the dot stays round and the labels keep their size. With
 * `scrub`, a press or drag along it picks the entry under the finger, until a mouse leaves or the chart goes.
 */
@Component({
  selector: 'hd-statistic-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    style: 'display: flex; flex-direction: column; flex: 1; min-height: 0',
  },
  template: `
    <svg
      #chartSvg
      class="hd-chart"
      [class.hd-chart--scrub]="scrub()"
      [attr.viewBox]="'0 0 ' + box().width + ' ' + box().height"
      aria-hidden="true"
      (pointerdown)="onPointer($event)"
      (pointermove)="onPointer($event)"
      (pointerleave)="onLeave($event)"
    >
      @for (line of chart().grid; track line.label) {
        <line
          class="hd-chart__grid"
          x1="0"
          [attr.x2]="chart().right"
          [attr.y1]="line.y"
          [attr.y2]="line.y"
        />
        <text
          class="hd-chart__axis"
          [attr.x]="box().width"
          [attr.y]="line.y"
          text-anchor="end"
          dominant-baseline="central"
        >
          {{ line.label }}
        </text>
      }
      <path class="hd-chart__area" [attr.d]="chart().area" />
      <path class="hd-chart__line" [attr.d]="chart().line" />
      @if (cursor(); as cursor) {
        <line
          class="hd-chart__cursor"
          [attr.x1]="cursor.x"
          [attr.x2]="cursor.x"
          [attr.y1]="0"
          [attr.y2]="box().height * 0.84"
        />
        <circle
          class="hd-chart__dot"
          [attr.cx]="cursor.x"
          [attr.cy]="cursor.y"
          r="6"
        />
      } @else if (chart().dot; as dot) {
        <circle
          class="hd-chart__dot"
          [attr.cx]="dot.x"
          [attr.cy]="dot.y"
          r="5"
        />
      }
      @if (chart().line) {
        <text class="hd-chart__axis" x="0" [attr.y]="box().height">
          {{ window().ago }}
        </text>
        <text
          class="hd-chart__axis"
          [attr.x]="chart().right"
          [attr.y]="box().height"
          text-anchor="end"
        >
          Now
        </text>
      }
    </svg>
  `,
})
export class StatisticChart {
  readonly entries = input.required<readonly HomeyInsightEntry[]>();
  readonly window = input.required<{ ago: string; ms: number }>();
  readonly scrub = input(false);
  /** The entry picked along the chart, or null when none is. */
  readonly picked = output<HomeyInsightEntry | null>();

  private readonly chartElement =
    viewChild.required<ElementRef<SVGSVGElement>>('chartSvg');
  protected readonly box = signal({ width: 300, height: 120, charWidth: 0 });
  protected readonly chart = computed(() =>
    drawChart(
      this.entries(),
      this.window().ms,
      this.box().width,
      this.box().height,
      this.box().charWidth,
    ),
  );
  private readonly pickedX = signal<number | null>(null);
  protected readonly cursor = computed(() => {
    const x = this.pickedX();
    return x === null ? null : nearestPoint(this.chart().points, x);
  });

  constructor() {
    effect((onCleanup) => {
      const element = this.chartElement().nativeElement;
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        // The labels are digits of about .6em; the font follows the cell size.
        const charWidth =
          parseFloat(getComputedStyle(element).fontSize) * 0.6 || 0;
        if (width > 0 && height > 0)
          this.box.set({
            width: Math.round(width),
            height: Math.round(height),
            charWidth,
          });
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });

    let last: HomeyInsightEntry | null = null;
    effect(() => {
      const entry = this.cursor()?.entry ?? null;
      if (entry !== last) untracked(() => this.picked.emit(entry));
      last = entry;
    });
    inject(DestroyRef).onDestroy(() => last && this.picked.emit(null));
  }

  protected onPointer(event: PointerEvent) {
    if (
      !this.scrub() ||
      (event.type === 'pointermove' &&
        event.pointerType !== 'mouse' &&
        !event.buttons)
    )
      return;
    const rect = this.chartElement().nativeElement.getBoundingClientRect();
    this.pickedX.set(
      ((event.clientX - rect.left) / rect.width) * this.box().width,
    );
  }

  // A finger stays picked after it lifts, so its value can be read.
  protected onLeave(event: PointerEvent) {
    if (event.pointerType === 'mouse') this.pickedX.set(null);
  }
}

