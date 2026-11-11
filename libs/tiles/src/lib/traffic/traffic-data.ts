import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Realtime, RouteTraffic, routeKey, TrafficRoute } from '@homey-dash/api-client';
import { TileSettings } from '../tile-data';
import { formatTag } from '@homey-dash/i18n';

/** A traffic tile's settings: the route it shows, and the TomTom account that asks for it (the oldest when absent). */
export interface TrafficTileSettings extends TileSettings {
  route?: TrafficRoute;
}

/** How much the traffic delays a trip, which colours the tile. */
export type DelayLevel = 'none' | 'some' | 'heavy';

/** Under 2 minutes, or 10%, is no delay worth a colour; 5 minutes and 25% is a heavy one. */
export function delayLevel(delaySeconds: number, usualSeconds: number): DelayLevel {
  if (delaySeconds >= Math.max(300, usualSeconds * 0.25)) return 'heavy';
  if (delaySeconds >= Math.max(120, usualSeconds * 0.1)) return 'some';
  return 'none';
}

/** `24 min`, or `1 h 05 min` from an hour on; rounded to the minute. */
export function duration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** `+6 min` for a delay, `On time` without one. */
export function delayText(delaySeconds: number, usualSeconds: number): string {
  return delayLevel(delaySeconds, usualSeconds) === 'none' ? 'On time' : `+${duration(delaySeconds)}`;
}

/** `21 km`, or `850 m` under a kilometre; one decimal under 10 km. */
export function distance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** 13:05, by the display's clock. */
export function timeOfDay(iso: string | number): string {
  return new Date(iso).toLocaleTimeString(formatTag(), { hour: '2-digit', minute: '2-digit' });
}

/** What a tile says while it has no result, from its status. */
export function trafficIdle(traffic: RouteTraffic | undefined): string {
  switch (traffic?.status) {
    case 'noAccount':
      return 'Set up TomTom in Management';
    case 'disconnected':
      return traffic.error ?? 'Cannot reach TomTom';
    default:
      return '…';
  }
}

/**
 * The traffic of every route in use, from HomeyDash's realtime connection (ADR-0015): a snapshot on every (re)connect,
 * then `Traffic` whenever one changes.
 */
@Injectable({ providedIn: 'root' })
export class TrafficData {
  private readonly realtime = inject(Realtime);

  /** Every route's, by route key; null until the first snapshot. */
  readonly routes = signal<RouteTraffic[] | null>(null);

  constructor() {
    const stops = [
      this.realtime.on('Traffic', (routes) => this.routes.set(routes)),
      this.realtime.whenConnected(() => this.load()),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  }

  /** The traffic on a route; undefined until HomeyDash has asked for it, which a moment after a route was chosen. */
  traffic(route: TrafficRoute | undefined | null): RouteTraffic | undefined {
    if (!route) return undefined;
    const key = routeKey(route);
    return (this.routes() ?? []).find((r) => r.routeKey === key);
  }

  /** Whether the traffic on a route can be shown: HomeyDash has a result, now or from before TomTom went away. */
  hasResult(traffic: RouteTraffic | undefined): traffic is RouteTraffic & { travelSeconds: number; usualSeconds: number; delaySeconds: number } {
    return traffic?.travelSeconds != null && traffic.usualSeconds != null && traffic.delaySeconds != null;
  }

  private async load() {
    try {
      this.routes.set(await this.realtime.traffic());
    } catch {
      // The connection dropped again; the next reconnect loads it.
    }
  }
}
