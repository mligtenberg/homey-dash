import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { HomeyApi, HomeyInsightEntry, HomeyInsightLog, InsightResolution, Realtime } from '@homey-dash/api-client';
import { LucideChartLine, LucideDynamicIcon } from '@lucide/angular';
import { KindHue } from '../tile-kind';
import { TileSettings } from '../tile-data';
import { deviceLook, formatReading } from './device-look';
import { TILE_FACE_HOST, TileFace, TileView } from './tile-view';

export interface StatisticTileSettings extends TileSettings {
  /** The time window the chart shows; absent is the last 24 hours. */
  window?: InsightResolution;
}

const HOUR = 3_600_000;

export const STATISTIC_WINDOWS: Record<InsightResolution, { label: string; ago: string; ms: number }> = {
  lastHour: { label: 'Last hour', ago: '1h ago', ms: HOUR },
  last24Hours: { label: 'Last 24 hours', ago: '24h ago', ms: 24 * HOUR },
  last7Days: { label: 'Last 7 days', ago: '7d ago', ms: 7 * 24 * HOUR },
  last31Days: { label: 'Last 31 days', ago: '31d ago', ms: 31 * 24 * HOUR },
};

/**
 * The device and capability a log records, from its id such as `homey:device:<id>:measure_power`. Homey's own
 * `energy_power` log is not a capability; it follows `measure_power`.
 */
export function logOwner(logId: string): { deviceId: string; capability: string } | null {
  const match = /^homey:device:([^:]+):(.+)$/.exec(logId);
  if (!match) return null;
  return { deviceId: match[1], capability: match[2] === 'energy_power' ? 'measure_power' : match[2] };
}

function logHue(log: HomeyInsightLog, ownerHue: KindHue): KindHue {
  const units = log.units ?? '';
  if (/power|meter|energy/.test(log.id) || /^(k?Wh?|A|V)$/.test(units)) return 'energy';
  if (/temperature/.test(log.id) || units.startsWith('°')) return 'climate';
  return ownerHue === 'neutral' ? 'energy' : ownerHue;
}

export interface Chart {
  line: string;
  area: string;
  dot: { x: number; y: number } | null;
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
 * values span round grid lines. A null value is a gap in the line.
 */
export function drawChart(entries: readonly HomeyInsightEntry[], windowMs: number, width: number, height: number): Chart {
  const points = entries.map((e) => ({ t: Date.parse(e.t), v: e.v }));
  const values = points.map((p) => p.v).filter((v): v is number => v !== null);
  if (values.length === 0) return { line: '', area: '', dot: null, grid: [] };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = niceStep(max - min || Math.abs(max) || 1);
  const low = Math.floor(min / step) * step;
  const high = Math.max(Math.ceil(max / step) * step, low + step);
  const top = height * 0.06;
  const bottom = height * 0.84; // Room below for the time labels.
  const end = points[points.length - 1].t;
  const x = (t: number) => round(((t - (end - windowMs)) / windowMs) * width);
  const y = (v: number) => round(bottom - ((v - low) / (high - low)) * (bottom - top));

  const segments: { x: number; y: number }[][] = [[]];
  for (const p of points) {
    if (p.t < end - windowMs) continue;
    if (p.v === null) segments.push([]);
    else segments[segments.length - 1].push({ x: x(p.t), y: y(p.v) });
  }
  const drawn = segments.filter((s) => s.length > 0);
  const path = (s: { x: number; y: number }[]) => s.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const grid = [];
  for (let v = low; v <= high + step / 2; v += step) grid.push({ y: y(v), label: v.toFixed(decimals) });

  return {
    line: drawn.map(path).join(' '),
    area: drawn.map((s) => `M${s[0].x},${bottom} ${path(s).replace('M', 'L')} L${s[s.length - 1].x},${bottom} Z`).join(' '),
    dot: drawn.length ? drawn[drawn.length - 1][drawn[drawn.length - 1].length - 1] : null,
    grid,
  };
}

@Component({
  selector: 'hd-statistic-tile',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, '[class.hd-stat]': "face().state === 'ok' || face().state === 'unavailable'" },
  template: `
    @if (face().state === 'ok' || face().state === 'unavailable') {
      <div class="hd-stat__head">
        <div>
          <div class="hd-tile__name">{{ face().name }}</div>
          <div class="hd-tile__detail">{{ face().detail }}</div>
        </div>
        @if (current(); as current) {
          <div class="hd-value hd-value--l">{{ current.value }}<span class="hd-unit">{{ current.units }}</span></div>
        }
      </div>
      <svg #chartSvg class="hd-chart" [attr.viewBox]="'0 0 ' + box().width + ' ' + box().height" aria-hidden="true">
        @for (line of chart().grid; track line.label) {
          <line class="hd-chart__grid" x1="0" [attr.x2]="box().width" [attr.y1]="line.y" [attr.y2]="line.y" />
          <text class="hd-chart__axis" [attr.x]="box().width" [attr.y]="line.y - 4" text-anchor="end">{{ line.label }}</text>
        }
        <path class="hd-chart__area" [attr.d]="chart().area" />
        <path class="hd-chart__line" [attr.d]="chart().line" />
        @if (chart().dot; as dot) {
          <circle class="hd-chart__dot" [attr.cx]="dot.x" [attr.cy]="dot.y" r="5" />
        }
        @if (chart().line) {
          <text class="hd-chart__axis" x="0" [attr.y]="box().height">{{ window().ago }}</text>
          <text class="hd-chart__axis" [attr.x]="box().width" [attr.y]="box().height" text-anchor="end">Now</text>
        }
      </svg>
      @if (face().state === 'unavailable') {
        <span class="hd-badge">Unavailable</span>
      }
    } @else {
      <svg class="hd-icon" [lucideIcon]="face().icon" />
      <div>
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
  `,
})
export class StatisticTile extends TileView<StatisticTileSettings> {
  private readonly homey = inject(HomeyApi);
  private readonly realtime = inject(Realtime);

  private readonly log = computed(() => this.data.insights().get(this.settings().target ?? ''));
  private readonly owner = computed(() => {
    const owner = logOwner(this.settings().target ?? '');
    return owner ? { device: this.data.devices().get(owner.deviceId), capability: owner.capability } : null;
  });
  protected readonly window = computed(() => STATISTIC_WINDOWS[this.settings().window ?? 'last24Hours']);

  private readonly history = rxResource({
    params: () => {
      const log = this.log();
      return log ? { log: log.id, window: this.settings().window ?? 'last24Hours' } : undefined;
    },
    stream: ({ params }) => this.homey.insightEntries(params.log, params.window),
  });
  /** The history with the owner device's live values appended. */
  private readonly entries = linkedSignal<HomeyInsightEntry[]>(() => (this.history.hasValue() ? this.history.value() : []));

  readonly face = computed<TileFace>(() => {
    const log = this.log();
    const device = this.owner()?.device;
    const base = { icon: LucideChartLine, hue: log ? logHue(log, deviceLook(device).hue) : ('energy' as const) };
    if (!log) return this.absentFace({ ...base, noun: 'Statistic' });
    const name = this.settings().label || [log.ownerName, log.title].filter(Boolean).join(' · ');
    return { ...base, name, detail: this.window().label, state: device && !device.available ? 'unavailable' : 'ok' };
  });

  protected readonly current = computed(() => {
    const last = [...this.entries()].reverse().find((e) => e.v !== null);
    return last ? formatReading(last.v as number, this.log()?.units ?? null) : null;
  });

  private readonly chartElement = viewChild<ElementRef<SVGSVGElement>>('chartSvg');
  protected readonly box = signal({ width: 300, height: 120 });
  protected readonly chart = computed(() => drawChart(this.entries(), this.window().ms, this.box().width, this.box().height));

  constructor() {
    super();
    // Draw in the chart's own pixels, so the dot stays round and the labels keep their size.
    effect((onCleanup) => {
      const element = this.chartElement()?.nativeElement;
      if (!element || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) this.box.set({ width: Math.round(width), height: Math.round(height) });
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });

    // Values missed while the connection was down are only in Homey's history.
    let wasConnected = untracked(this.realtime.connected);
    effect(() => {
      const connected = this.realtime.connected();
      if (connected && !wasConnected) untracked(() => this.history.reload());
      wasConnected = connected;
    });

    effect(() => {
      const owner = this.owner();
      const capability = owner?.device?.capabilities[owner.capability];
      if (typeof capability?.value !== 'number') return;
      const entry = { t: capability.lastUpdated ?? new Date().toISOString(), v: capability.value };
      const windowMs = untracked(this.window).ms;
      untracked(() =>
        this.entries.update((entries) => {
          const last = entries[entries.length - 1];
          if (last && Date.parse(last.t) >= Date.parse(entry.t)) return entries;
          const start = Date.parse(entry.t) - windowMs;
          return [...entries.filter((e) => Date.parse(e.t) >= start), entry];
        }),
      );
    });
  }
}

/** Management's choice of the time window a statistic tile shows. */
@Component({
  selector: 'hd-statistic-tile-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" for="tile-window">Time window</label>
      <select id="tile-window" class="hd-select" (change)="changed.emit({ window: $any($event.target).value })">
        @for (option of windows; track option.id) {
          <option [value]="option.id" [selected]="option.id === (settings().window ?? 'last24Hours')">{{ option.label }}</option>
        }
      </select>
    </div>
  `,
})
export class StatisticTileSettingsEditor {
  readonly settings = input.required<StatisticTileSettings>();
  readonly changed = output<Partial<StatisticTileSettings>>();

  protected readonly windows = Object.entries(STATISTIC_WINDOWS).map(([id, { label }]) => ({ id, label }));
}
