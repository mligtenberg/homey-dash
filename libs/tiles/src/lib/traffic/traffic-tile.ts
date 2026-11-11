import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { samePlaces } from '@homey-dash/api-client';
import { LucideCar } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { KindHue } from '../tile-kind';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';
import { timeOfDay, delayLevel, delayText, distance, duration, TrafficData, trafficIdle, TrafficTileSettings } from './traffic-data';
import { TranslatePipe } from '@homey-dash/i18n';

const HUES: Record<'none' | 'some' | 'heavy', KindHue> = { none: 'climate', some: 'light', heavy: 'heat' };

/**
 * The car travel time on one route now, from TomTom (ADR-0015): the minutes it takes, and the delay over the usual time,
 * which colours the tile (blue on time, amber a delay, red a heavy one). From wide up it adds the distance and the arrival
 * time when leaving now; large tiles add the usual time. Without a TomTom account it says so.
 */
@Component({
  selector: 'hd-traffic-tile',
  imports: [LucideDynamicIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-traffic', '[class.has-traffic]': '!!shown()' },
  template: `
    @if (shown(); as shown) {
      <div class="hd-row hd-row--top hd-traffic__now">
        <svg class="hd-icon" [lucideIcon]="face().icon" aria-hidden="true" />
        <span class="hd-value" [class.hd-value--l]="size() !== 'small'" [class.hd-value--m]="size() === 'small'">{{ shown.number }} <span class="hd-unit">{{ 'min' | t }}</span></span>
      </div>
      <div class="hd-traffic__titles">
        <div class="hd-tile__name">{{ face().name | t }}</div>
        <div class="hd-tile__detail">{{ face().detail | t }}</div>
      </div>
      @if (figures().length) {
        <dl class="hd-traffic__figures">
          @for (figure of figures(); track figure.label) {
            <div class="hd-traffic__figure">
              <dt class="hd-traffic__label">{{ figure.label | t }}</dt>
              <dd class="hd-traffic__value">{{ figure.value }}</dd>
            </div>
          }
        </dl>
      }
    } @else {
      <svg class="hd-icon" [lucideIcon]="face().icon" />
      <div>
        <div class="hd-tile__name">{{ face().name | t }}</div>
        <div class="hd-tile__detail">{{ face().detail | t }}</div>
      </div>
    }
  `,
})
export class TrafficTile extends TileView<TrafficTileSettings> {
  private readonly traffic = inject(TrafficData);

  protected readonly result = computed(() => this.traffic.traffic(this.settings().route));

  /** What the tile shows, once there is a result (also an old one, while TomTom can't be reached). */
  protected readonly shown = computed(() => {
    const result = this.result();
    if (!this.traffic.hasResult(result)) return null;
    return {
      time: duration(result.travelSeconds),
      // The minutes, without their unit, which is set smaller.
      number: duration(result.travelSeconds).replace(/ min$/, ''),
      delay: delayText(result.delaySeconds, result.usualSeconds),
      level: delayLevel(result.delaySeconds, result.usualSeconds),
    };
  });

  /** The figures under the time, as many as the size has room for. */
  protected readonly figures = computed(() => {
    const result = this.result();
    if (!this.traffic.hasResult(result) || this.size() === 'small') return [];
    const figures = [
      { label: 'Distance', value: distance(result.distanceMeters ?? 0) },
      { label: 'Arrive', value: result.arrival ? timeOfDay(result.arrival) : '–' },
    ];
    if (this.size() === 'large' || this.size() === 'full-large') figures.push({ label: 'Usual', value: duration(result.usualSeconds) });
    if (result.updatedAt) figures.push({ label: result.status === 'disconnected' ? 'Out of date' : 'Updated', value: timeOfDay(result.updatedAt) });
    return figures;
  });

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideCar };
    const { label, route } = this.settings();
    const name = label || route?.name || 'Traffic';
    if (!route) return { ...look, hue: 'climate', name, detail: 'Pick a route', state: 'unset' };
    // HomeyDash asks no traffic for a route that goes nowhere.
    if (samePlaces(route)) return { ...look, hue: 'climate', name, detail: 'Pick two different places', state: 'unset' };
    const shown = this.shown();
    const result = this.result();
    if (shown) {
      return {
        ...look,
        hue: HUES[shown.level],
        name,
        detail: result?.status === 'disconnected' ? `${shown.delay} · ${result.error ?? 'Cannot reach TomTom'}` : shown.delay,
        state: result?.status === 'disconnected' ? 'unavailable' : 'ok',
      };
    }
    if (!this.traffic.routes() || !result || result.status === 'loading') return { ...look, hue: 'climate', name, detail: '…', state: 'loading' };
    return { ...look, hue: 'climate', name, detail: trafficIdle(result), state: 'unavailable' };
  });
}
