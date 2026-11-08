import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { HomeyInsightEntry } from '@homey-dash/api-client';
import { LucideArrowDown, LucideArrowUp, LucideEqual, LucideHouse, LucideSun, LucideZap } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { StatisticChart } from '../core/statistic-chart';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';
import {
  EnergyTileSettings,
  energyIdle,
  flowSegments,
  formatCost,
  formatEnergy,
  formatPower,
  gridFlow,
  gridSentence,
  gridWord,
  hourBars,
} from './energy-data';

const WIDE = ['wide', 'full', 'large', 'full-large', 'full-tall'];
const DAY = ['large', 'full-large', 'full-tall'];
const TOTALS = ['full-large', 'full-tall'];

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** A figure of the full view: `Used today 11.2 kWh`, with a note under it. */
interface Figure {
  label: string;
  value: string;
  note?: string;
}

/**
 * The energy of a Homey from its own energy report (ADR-0014): the grid power now, importing or exporting, as the one
 * headline number; from wide up the sun's production and the home's consumption with a bar of where the power comes from,
 * and on the large sizes today's totals and the day by the hour. A press opens today in full: the figures of the day, the
 * meter's power through it, the hours, and the devices that used the most.
 */
@Component({
  selector: 'hd-energy-tile',
  imports: [TileDetails, LucideDynamicIcon, StatisticChart, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-energy', '[class.has-live]': '!!live()' },
  template: `
    <ng-template #hours>
      <div class="hd-energy__day" role="img" [attr.aria-label]="hoursLabel()">
        <svg viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true">
          @for (bar of bars(); track bar.hour) {
            <rect class="hd-energy__bar-home" [attr.x]="bar.hour * 10 + 1" [attr.y]="60 - bar.height.home" width="8" [attr.height]="bar.height.home" rx="1.5" />
            @if (bar.height.solar) {
              <rect class="hd-energy__bar-solar" [attr.x]="bar.hour * 10 + 3" [attr.y]="60 - bar.height.solar" width="4" [attr.height]="bar.height.solar" rx="1" />
            }
          }
        </svg>
        <div class="hd-energy__axis"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      </div>
    </ng-template>
    @if (live()) {
      <div class="hd-row hd-row--top hd-energy__now">
        <svg class="hd-icon" [lucideIcon]="flowIcon()" aria-hidden="true" />
        <span class="hd-value">{{ gridText() }}</span>
      </div>
      <div class="hd-energy__titles">
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
      @if (wide()) {
        <dl class="hd-energy__figures">
          @if (live()!.solar !== null) {
            <div><dt><svg class="hd-icon" [lucideIcon]="sunIcon" aria-hidden="true" />Solar</dt><dd>{{ power(live()!.solar) }}</dd></div>
          }
          @if (live()!.home !== null) {
            <div><dt><svg class="hd-icon" [lucideIcon]="homeIcon" aria-hidden="true" />Home</dt><dd>{{ power(live()!.home) }}</dd></div>
          }
          @if (todayHome() !== null && live()!.solar === null) {
            <div><dt><svg class="hd-icon" [lucideIcon]="zapIcon" aria-hidden="true" />Today</dt><dd>{{ kwh(todayHome()!) }}</dd></div>
          }
        </dl>
        @if (segments(); as s) {
          <div class="hd-energy__flow" role="img" [attr.aria-label]="flowLabel()">
            <span class="hd-energy__seg hd-energy__seg--solar" [style.flex-grow]="s.solar"></span>
            <span class="hd-energy__seg hd-energy__seg--grid" [style.flex-grow]="s.grid"></span>
            <span class="hd-energy__seg hd-energy__seg--export" [style.flex-grow]="s.export"></span>
          </div>
        }
      }
      @if (totals() && today(); as day) {
        <dl class="hd-energy__today">
          @if (day.home !== null) { <div><dt>Used</dt><dd>{{ kwh(day.home) }}</dd></div> }
          @if (day.imported !== null) { <div><dt>Imported</dt><dd>{{ kwh(day.imported) }}</dd></div> }
          @if (day.solar !== null) { <div><dt>Solar</dt><dd>{{ kwh(day.solar) }}</dd></div> }
          @if (day.exported) { <div><dt>Exported</dt><dd>{{ kwh(day.exported) }}</dd></div> }
          @if (day.cost !== null) { <div><dt>Cost</dt><dd>{{ cost(day.cost) }}</dd></div> }
        </dl>
      }
      @if (showDay() && bars().length) {
        <ng-container [ngTemplateOutlet]="hours" />
      }
    } @else {
      <svg class="hd-icon" [lucideIcon]="zapIcon" />
      <div>
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
    <hd-tile-details [screen]="true" [name]="face().name" [icon]="zapIcon" [subtitle]="face().detail">
      @if (live(); as live) {
        <div class="hd-energy__pane">
          <section class="hd-energy__hero">
            <svg class="hd-icon" [lucideIcon]="flowIcon()" aria-hidden="true" />
            <div class="hd-energy__hero-text">
              <div class="hd-value hd-value--xl">{{ gridText() }}</div>
              <div class="hd-details__state">{{ heroState() }}</div>
              @if (segments(); as s) {
                <div class="hd-energy__flow" role="img" [attr.aria-label]="flowLabel()">
                  <span class="hd-energy__seg hd-energy__seg--solar" [style.flex-grow]="s.solar"></span>
                  <span class="hd-energy__seg hd-energy__seg--grid" [style.flex-grow]="s.grid"></span>
                  <span class="hd-energy__seg hd-energy__seg--export" [style.flex-grow]="s.export"></span>
                </div>
              }
            </div>
          </section>
          @if (figures().length) {
            <dl class="hd-stat__figures">
              @for (figure of figures(); track figure.label) {
                <div class="hd-stat__figure">
                  <dt class="hd-details__label">{{ figure.label }}</dt>
                  <dd class="hd-stat__figure-value">{{ figure.value }}</dd>
                  @if (figure.note) { <dd class="hd-stat__figure-note">{{ figure.note }}</dd> }
                </div>
              }
            </dl>
          }
          <div class="hd-energy__sections">
            @if (powerWindow(); as window) {
              <section class="hd-energy__section hd-energy__section--power">
                <div class="hd-energy__section-head">
                  <h3 class="hd-details__label">Power today</h3>
                  <span class="hd-energy__readout">{{ powerReadout() }}</span>
                </div>
                <div class="hd-energy__chart">
                  <hd-statistic-chart [entries]="today()!.power" [window]="window" [scrub]="true" (picked)="picked.set($event)" />
                </div>
              </section>
            }
            @if (bars().length) {
              <section class="hd-energy__section">
                <div class="hd-energy__section-head">
                  <h3 class="hd-details__label">Today by the hour</h3>
                  @if (busiest(); as hour) { <span class="hd-energy__readout">Most at {{ hour }}</span> }
                </div>
                <ng-container [ngTemplateOutlet]="hours" />
                <p class="hd-energy__legend">
                  <span class="hd-energy__key hd-energy__key--home"></span>Used
                  @if (hasSolar()) { <span class="hd-energy__key hd-energy__key--solar"></span>Solar }
                </p>
              </section>
            }
            @if (devices().length) {
              <section class="hd-energy__section">
                <div class="hd-energy__section-head">
                  <h3 class="hd-details__label">Devices today</h3>
                  @if (devicesNote(); as note) { <span class="hd-energy__readout">{{ note }}</span> }
                </div>
                <ol class="hd-energy__devices">
                  @for (device of devices(); track device.name) {
                    <li>
                      <span class="hd-energy__device-name">{{ device.name }}</span>
                      <span class="hd-energy__device-kwh">{{ kwh(device.kwh) }}</span>
                      <span class="hd-energy__device-bar" [style.--share]="device.share"></span>
                    </li>
                  }
                </ol>
              </section>
            }
          </div>
          <p class="hd-energy__credit">Homey's own energy report</p>
        </div>
      }
    </hd-tile-details>
  `,
})
export class EnergyTile extends TileView<EnergyTileSettings> {
  protected readonly zapIcon = LucideZap;
  protected readonly sunIcon = LucideSun;
  protected readonly homeIcon = LucideHouse;
  protected readonly power = (watts: number | null) => (watts === null ? '' : formatPower(watts));
  protected readonly kwh = formatEnergy;
  protected readonly cost = (cost: number) => formatCost(cost, this.today()?.currency ?? null);

  protected readonly energy = computed(() => this.homey()?.energy ?? null);
  protected readonly live = computed(() => {
    const live = this.energy()?.live;
    return this.energy()?.status === 'ok' && live && (live.grid ?? live.home ?? live.solar) !== null ? live : null;
  });
  protected readonly today = computed(() => this.energy()?.day ?? null);
  protected readonly todayHome = computed(() => this.today()?.home ?? null);
  protected readonly flow = computed(() => gridFlow(this.live()?.grid ?? null));
  protected readonly segments = computed(() => (this.hasSolar() ? flowSegments(this.live()) : null));
  protected readonly hasSolar = computed(() => this.live()?.solar != null || !!this.today()?.solar);
  protected readonly wide = computed(() => WIDE.includes(this.size()));
  protected readonly showDay = computed(() => DAY.includes(this.size()));
  protected readonly totals = computed(() => TOTALS.includes(this.size()));

  /** The headline: the grid power, or what the home uses where Homey tells no grid figure. */
  protected readonly gridText = computed(() => {
    const live = this.live();
    return live ? formatPower(live.grid ?? live.home ?? live.solar ?? 0) : '';
  });
  protected readonly heroState = computed(() => {
    const flow = this.flow();
    return flow ? gridSentence(flow) : 'Used by the home';
  });
  protected readonly flowIcon = computed(() => {
    const flow = this.flow();
    return flow === 'import' ? LucideArrowDown : flow === 'export' ? LucideArrowUp : flow === 'balanced' ? LucideEqual : LucideZap;
  });
  protected readonly flowLabel = computed(() => {
    const s = this.segments();
    const pct = (f: number) => `${Math.round(f * 100)}%`;
    return s ? `Solar ${pct(s.solar)}, grid ${pct(s.grid)}, exported ${pct(s.export)}` : '';
  });

  /** The day's bars, scaled to the biggest hour of either, to heights in the chart's 60 units. */
  protected readonly bars = computed(() => {
    const bars = hourBars(this.today()?.history ?? []);
    const top = Math.max(0.1, ...bars.map((b) => Math.max(b.home, b.solar)));
    const height = (kwh: number) => Math.max(1.5, (kwh / top) * 58);
    return bars.map((b) => ({ hour: b.hour, kwh: b.home, height: { home: height(b.home), solar: b.solar > 0 ? height(b.solar) : 0 } }));
  });
  protected readonly hoursLabel = computed(() => {
    const hour = this.busiest();
    return hour ? `Today by the hour, most at ${hour}` : 'Today by the hour';
  });
  /** The hour the home used the most: `18:00 · 1.6 kWh`. */
  protected readonly busiest = computed(() => {
    const top = this.bars().reduce<{ hour: number; kwh: number } | null>((a, b) => (!a || b.kwh > a.kwh ? b : a), null);
    return top && top.kwh > 0 ? `${top.hour}:00 · ${formatEnergy(top.kwh)}` : null;
  });

  /** The meter's power through the day, from midnight to its last reading; null without readings. */
  protected readonly powerWindow = computed(() => {
    const power = this.today()?.power ?? [];
    if (power.length < 2) return null;
    const last = new Date(power[power.length - 1].t);
    const midnight = new Date(last.getFullYear(), last.getMonth(), last.getDate());
    return { ago: '0:00', ms: Math.max(1, last.getTime() - midnight.getTime()) };
  });
  protected readonly picked = signal<HomeyInsightEntry | null>(null);
  private readonly peak = computed(() =>
    (this.today()?.power ?? []).reduce<HomeyInsightEntry | null>((a, b) => (b.v !== null && (!a || b.v > (a.v ?? -Infinity)) ? b : a), null),
  );
  protected readonly powerReadout = computed(() => {
    const picked = this.picked();
    if (picked?.v != null) return `${formatPower(picked.v)} at ${time(picked.t)}`;
    const peak = this.peak();
    return peak?.v != null ? `Peak ${formatPower(peak.v)} at ${time(peak.t)}` : '';
  });

  /** The devices that used the most today, each with its share of the top one for its bar. */
  protected readonly devices = computed(() => {
    const devices = this.today()?.devices ?? [];
    const top = Math.max(0.001, ...devices.map((d) => d.kwh));
    return devices.map((d) => ({ ...d, share: d.kwh / top }));
  });
  /** How much of the home's use the devices account for: they only know what they measure or estimate themselves. */
  protected readonly devicesNote = computed(() => {
    const home = this.today()?.home;
    const listed = this.devices().reduce((sum, d) => sum + d.kwh, 0);
    return home ? `${Math.round((listed / home) * 100)}% of what the home used` : null;
  });

  /** The figures of the full view: what is going on now beside the headline, and today. */
  protected readonly figures = computed<Figure[]>(() => {
    const live = this.live();
    const day = this.today();
    const figures: Figure[] = [];
    if (live?.home != null && live.grid != null && live.solar != null) figures.push({ label: 'Home now', value: formatPower(live.home) });
    if (live?.solar != null) figures.push({ label: 'Solar now', value: formatPower(live.solar) });
    if (day?.home != null) {
      const hours = (Date.now() - new Date().setHours(0, 0, 0, 0)) / 3_600_000;
      figures.push({ label: 'Used today', value: formatEnergy(day.home), note: hours > 0.5 ? `about ${formatPower((day.home * 1000) / hours)} on average` : undefined });
    }
    if (day?.cost != null) {
      // Per kWh only when nothing went back: the cost is what came in less what went out.
      const price = day.imported && !day.exported ? day.cost / day.imported : null;
      figures.push({ label: 'Cost today', value: formatCost(day.cost, day.currency), note: price ? `${formatCost(price, day.currency)} per kWh` : undefined });
    }
    const peak = this.peak();
    if (peak?.v != null) figures.push({ label: 'Peak today', value: formatPower(peak.v), note: `at ${time(peak.t)}` });
    if (this.hasSolar()) {
      if (day?.solar != null) figures.push({ label: 'Solar today', value: formatEnergy(day.solar) });
      if (day?.imported != null) figures.push({ label: 'Imported today', value: formatEnergy(day.imported) });
      if (day?.exported != null) figures.push({ label: 'Exported today', value: formatEnergy(day.exported) });
    }
    return figures;
  });

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideZap, hue: 'energy' as const };
    const name = this.settings().label || 'Energy';
    const live = this.live();
    if (live) {
      const flow = this.flow();
      return { ...look, name, detail: flow ? gridWord(flow) : 'Home', details: true, active: flow === 'export', state: 'ok' };
    }
    if (!this.data.homeys()) return { ...look, name, detail: '…', state: 'loading' };
    const homey = this.homey();
    const energy = this.energy();
    const detail = energyIdle(energy, !!homey, this.data.homeyLost(this.settings().account));
    if (!homey) return { ...look, name, detail, state: this.settings().account === undefined ? 'unavailable' : 'missing' };
    return { ...look, name, detail, state: !energy || energy.status === 'ok' ? 'loading' : 'unavailable' };
  });
}
