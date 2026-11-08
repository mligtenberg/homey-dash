import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Forecast, placeKey, RainPoint, Realtime, WEATHER_PLACE, WeatherPlace } from '@homey-dash/api-client';
import {
  LucideCloud,
  LucideCloudDrizzle,
  LucideCloudFog,
  LucideCloudLightning,
  LucideCloudMoon,
  LucideCloudMoonRain,
  LucideCloudRain,
  LucideCloudSnow,
  LucideCloudSun,
  LucideCloudSunRain,
  LucideIconInput,
  LucideMoon,
  LucideSnowflake,
  LucideSun,
} from '@lucide/angular';
import { TileSettings } from '../tile-data';

/** A weather tile's settings: where its Homey is (`weather:here`), or at `place` (`weather:place`). */
export interface WeatherTileSettings extends TileSettings {
  place?: WeatherPlace;
}

/** What a WMO weather code looks like: an icon (by day or night) and a short word for it. */
export interface WeatherLook {
  icon: LucideIconInput;
  text: string;
}

/** The look of a WMO weather code, as Open-Meteo gives it; `day` picks a sun or a moon where it shows. */
export function weatherLook(code: number, day = true): WeatherLook {
  const clear = day ? LucideSun : LucideMoon;
  const partly = day ? LucideCloudSun : LucideCloudMoon;
  const showers = day ? LucideCloudSunRain : LucideCloudMoonRain;
  switch (code) {
    case 0:
      return { icon: clear, text: 'Clear' };
    case 1:
      return { icon: clear, text: 'Mostly clear' };
    case 2:
      return { icon: partly, text: 'Partly cloudy' };
    case 3:
      return { icon: LucideCloud, text: 'Cloudy' };
    case 45:
    case 48:
      return { icon: LucideCloudFog, text: 'Fog' };
    case 51:
    case 53:
    case 55:
      return { icon: LucideCloudDrizzle, text: 'Drizzle' };
    case 56:
    case 57:
      return { icon: LucideCloudDrizzle, text: 'Freezing drizzle' };
    case 61:
      return { icon: LucideCloudRain, text: 'Light rain' };
    case 63:
      return { icon: LucideCloudRain, text: 'Rain' };
    case 65:
      return { icon: LucideCloudRain, text: 'Heavy rain' };
    case 66:
    case 67:
      return { icon: LucideCloudRain, text: 'Freezing rain' };
    case 71:
      return { icon: LucideCloudSnow, text: 'Light snow' };
    case 73:
      return { icon: LucideCloudSnow, text: 'Snow' };
    case 75:
      return { icon: LucideCloudSnow, text: 'Heavy snow' };
    case 77:
      return { icon: LucideSnowflake, text: 'Snow grains' };
    case 80:
    case 81:
      return { icon: showers, text: 'Showers' };
    case 82:
      return { icon: LucideCloudRain, text: 'Heavy showers' };
    case 85:
    case 86:
      return { icon: LucideCloudSnow, text: 'Snow showers' };
    case 95:
      return { icon: LucideCloudLightning, text: 'Thunderstorm' };
    case 96:
    case 99:
      return { icon: LucideCloudLightning, text: 'Thunderstorm with hail' };
    default:
      return { icon: LucideCloud, text: 'Unknown' };
  }
}

/** Below this many mm per hour it counts as dry: Buienradar's lightest drizzle is about 0.1. */
export const RAIN_FROM = 0.1;

/** 13:05, by the display's clock. */
export function clockTime(iso: string | number): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** 8°, rounded; the minus is a true minus sign. */
export function degrees(value: number): string {
  return `${Math.round(value)}°`.replace('-', '−');
}

/**
 * What the rain of the next two hours comes to, from the five minutes that hold `now`: `Rain until 13:40`, `Rain from 13:10`,
 * or null while it stays dry or Buienradar doesn't know.
 */
export function rainSummary(rain: readonly RainPoint[] | null, now: number): string | null {
  const ahead = (rain ?? []).filter((p) => new Date(p.time).getTime() + 5 * 60_000 > now);
  const starts = ahead.find((p) => p.rate >= RAIN_FROM);
  if (!starts) return null;
  if (starts !== ahead[0]) return `Rain from ${clockTime(starts.time)}`;
  const stops = ahead.find((p) => p.rate < RAIN_FROM);
  return stops ? `Rain until ${clockTime(stops.time)}` : 'Rain for 2 hours';
}

/** What a tile says while it has no forecast, from its status. */
export function weatherIdle(forecast: Forecast | undefined, homeys: boolean): string {
  if (!forecast) return homeys ? 'Homey not found' : 'Homey is not set up';
  switch (forecast.status) {
    case 'noLocation':
      return 'Set a location in Homey';
    case 'disconnected':
      return forecast.error ?? 'Cannot reach Open-Meteo';
    default:
      return '…';
  }
}

/**
 * The weather where each Homey is, from HomeyDash's realtime connection (ADR-0013): a snapshot on every (re)connect, then
 * `Forecasts` whenever one changes.
 */
@Injectable({ providedIn: 'root' })
export class WeatherData {
  private readonly realtime = inject(Realtime);

  /** Every Homey's, oldest account first; null until the first snapshot. */
  readonly forecasts = signal<Forecast[] | null>(null);

  constructor() {
    const stops = [
      this.realtime.on('Forecasts', (forecasts) => this.forecasts.set(forecasts)),
      this.realtime.whenConnected(() => this.load()),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  }

  /**
   * A tile's forecast: at its place, or where the Homey of its account is (the oldest when it names none); undefined when
   * there is no such Homey, or the place's forecast hasn't come yet.
   */
  forecast(settings: Pick<WeatherTileSettings, 'target' | 'account' | 'place'>): Forecast | undefined {
    const all = this.forecasts() ?? [];
    if (settings.target === WEATHER_PLACE) {
      const key = settings.place && placeKey(settings.place);
      return all.find((f) => f.placeKey === key);
    }
    const homeys = all.filter((f) => f.accountId !== null);
    return settings.account == null ? homeys[0] : homeys.find((f) => f.accountId === settings.account);
  }

  private async load() {
    try {
      this.forecasts.set(await this.realtime.forecasts());
    } catch {
      // The connection dropped again; the next reconnect loads it.
    }
  }
}
