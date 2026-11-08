import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { LucideArrowDown, LucideArrowUp, LucideDynamicIcon, LucideEqual, LucideHouse, LucideSun, LucideZap } from '@lucide/angular';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';
import {
  EnergyTileSettings,
  energyIdle,
  flowSegments,
  formatEnergy,
  formatPower,
  gridFlow,
  gridWord,
  hourBars,
} from './energy-data';

const WIDE = ['wide', 'full', 'large', 'full-large', 'full-tall'];
const DAY = ['large', 'full-large', 'full-tall'];
const TOTALS = ['full-large', 'full-tall'];

/**
 * The energy of a Homey from its own energy report (ADR-0014): the grid power now, importing or exporting, as the one
 * headline number; from wide up the sun's production and the home's consumption with a bar of where the power comes from,
 * and on the large sizes today's totals and the day by the hour. A press opens today in full.
 */
@Component({
  selector: 'hd-energy-tile',
  imports: [TileDetails, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-energy', '[class.has-live]': '!!live()' },
  template: `
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
          @if (day.imported !== null) { <div><dt>Imported</dt><dd>{{ kwh(day.imported) }}</dd></div> }
          @if (day.exported !== null) { <div><dt>Exported</dt><dd>{{ kwh(day.exported) }}</dd></div> }
          @if (day.solar !== null) { <div><dt>Solar</dt><dd>{{ kwh(day.solar) }}</dd></div> }
          @if (day.home !== null) { <div><dt>Home</dt><dd>{{ kwh(day.home) }}</dd></div> }
        </dl>
      }
      @if (showDay() && bars().length) {
        <div class="hd-energy__day" role="img" aria-label="Today by the hour">
          <svg viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true">
            @for (bar of bars(); track bar.hour) {
              <rect class="hd-energy__bar-solar" [attr.x]="bar.hour * 10 + 1" [attr.y]="60 - bar.height.solar" width="8" [attr.height]="bar.height.solar" rx="2" />
              <rect class="hd-energy__bar-home" [attr.x]="bar.hour * 10 + 1" [attr.y]="60 - bar.height.home" width="8" [attr.height]="2" rx="1" />
            }
          </svg>
          <div class="hd-energy__axis"><span>0:00</span><span>12:00</span><span>24:00</span></div>
        </div>
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
            <div>
              <div class="hd-value hd-value--xl">{{ gridText() }}</div>
              <div class="hd-details__state">{{ face().detail }}</div>
            </div>
          </section>
          @if (segments(); as s) {
            <div class="hd-energy__flow" role="img" [attr.aria-label]="flowLabel()">
              <span class="hd-energy__seg hd-energy__seg--solar" [style.flex-grow]="s.solar"></span>
              <span class="hd-energy__seg hd-energy__seg--grid" [style.flex-grow]="s.grid"></span>
              <span class="hd-energy__seg hd-energy__seg--export" [style.flex-grow]="s.export"></span>
            </div>
          }
          <dl class="hd-stat__figures">
            @if (live.solar !== null) { <div class="hd-stat__figure"><dt class="hd-details__label">Solar now</dt><dd class="hd-stat__figure-value">{{ power(live.solar) }}</dd></div> }
            @if (live.home !== null) { <div class="hd-stat__figure"><dt class="hd-details__label">Home now</dt><dd class="hd-stat__figure-value">{{ power(live.home) }}</dd></div> }
            @if (today(); as day) {
              @if (day.imported !== null) { <div class="hd-stat__figure"><dt class="hd-details__label">Imported today</dt><dd class="hd-stat__figure-value">{{ kwh(day.imported) }}</dd></div> }
              @if (day.exported !== null) { <div class="hd-stat__figure"><dt class="hd-details__label">Exported today</dt><dd class="hd-stat__figure-value">{{ kwh(day.exported) }}</dd></div> }
              @if (day.solar !== null) { <div class="hd-stat__figure"><dt class="hd-details__label">Solar today</dt><dd class="hd-stat__figure-value">{{ kwh(day.solar) }}</dd></div> }
              @if (day.home !== null) { <div class="hd-stat__figure"><dt class="hd-details__label">Home today</dt><dd class="hd-stat__figure-value">{{ kwh(day.home) }}</dd></div> }
            }
          </dl>
          @if (bars().length) {
            <section class="hd-energy__section">
              <h3 class="hd-details__label">Today by the hour</h3>
              <div class="hd-energy__day">
                <svg viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true">
                  @for (bar of bars(); track bar.hour) {
                    <rect class="hd-energy__bar-solar" [attr.x]="bar.hour * 10 + 1" [attr.y]="60 - bar.height.solar" width="8" [attr.height]="bar.height.solar" rx="2" />
                    <rect class="hd-energy__bar-home" [attr.x]="bar.hour * 10 + 1" [attr.y]="60 - bar.height.home" width="8" [attr.height]="2" rx="1" />
                  }
                </svg>
                <div class="hd-energy__axis"><span>0:00</span><span>12:00</span><span>24:00</span></div>
              </div>
              <p class="hd-energy__legend"><span class="hd-energy__key hd-energy__key--solar"></span>Solar<span class="hd-energy__key hd-energy__key--home"></span>Home</p>
            </section>
          }
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

  protected readonly energy = computed(() => this.homey()?.energy ?? null);
  protected readonly live = computed(() => {
    const live = this.energy()?.live;
    return this.energy()?.status === 'ok' && live && (live.grid ?? live.home ?? live.solar) !== null ? live : null;
  });
  protected readonly today = computed(() => this.energy()?.day ?? null);
  protected readonly flow = computed(() => gridFlow(this.live()?.grid ?? null));
  protected readonly segments = computed(() => flowSegments(this.live()));
  protected readonly wide = computed(() => WIDE.includes(this.size()));
  protected readonly showDay = computed(() => DAY.includes(this.size()));
  protected readonly totals = computed(() => TOTALS.includes(this.size()));

  /** The headline: the grid power, or what the home uses where Homey tells no grid figure. */
  protected readonly gridText = computed(() => {
    const live = this.live();
    return live ? formatPower(live.grid ?? live.home ?? live.solar ?? 0) : '';
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
    const height = (kwh: number) => Math.max(2, (kwh / top) * 58);
    return bars.map((b) => ({ hour: b.hour, height: { home: height(b.home), solar: b.solar > 0 ? height(b.solar) : 0 } }));
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
