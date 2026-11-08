import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

// Mirrors apps/api/Weather (ADR-0013).

/** A weather tile's target: the weather where its Homey (`settings.account`) is. */
export const WEATHER_HERE = 'weather:here';
/** A weather tile's target: the weather at a place of its own, `settings.place`. */
export const WEATHER_PLACE = 'weather:place';

/** A place a weather tile shows the weather of, instead of where its Homey is. */
export interface WeatherPlace {
  name: string;
  latitude: number;
  longitude: number;
}

/** The key the forecast of a place goes by: tiles at the same place, to two decimals, share it. */
export function placeKey(place: Pick<WeatherPlace, 'latitude' | 'longitude'>): string {
  return `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`;
}

/** A town found by name; its region and country tell namesakes apart. */
export interface PlaceMatch {
  name: string;
  region: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
}

@Injectable({ providedIn: 'root' })
export class WeatherApi {
  private readonly http = inject(HttpClient);

  /** Towns whose name starts with `query` (from two letters), best first, named in `language` where Open-Meteo can. */
  places(query: string, language: string) {
    return this.http.get<PlaceMatch[]>('/api/weather/places', { params: { query, language } });
  }
}

/** The weather now. `code` is a WMO weather code; `humidity` a fraction 0–1; wind in km/h from `windDirection` degrees. */
export interface WeatherNow {
  temperature: number;
  feelsLike: number;
  code: number;
  day: boolean;
  humidity: number;
  wind: number;
  windDirection: number;
  /** mm over the last 15 minutes. */
  precipitation: number;
}

export interface WeatherHour {
  time: string;
  temperature: number;
  code: number;
  day: boolean;
  /** % */
  precipitationChance: number;
  /** mm */
  precipitation: number;
}

export interface WeatherDay {
  /** yyyy-mm-dd, in the location's own time zone. */
  date: string;
  code: number;
  low: number;
  high: number;
  precipitationChance: number;
  precipitation: number;
  sunrise: string;
  sunset: string;
}

/** How hard it rains, or will, from `time` for five minutes, in mm per hour. */
export interface RainPoint {
  time: string;
  rate: number;
}

/**
 * The weather where the Homey of one account is (`accountId`), or at a tile's own place (`placeKey`): Open-Meteo's forecast
 * and Buienradar's rain for the next two hours. `rain` is null where Buienradar doesn't know (outside the Netherlands and
 * Belgium). The last forecast stays while `disconnected`.
 */
export interface Forecast {
  accountId: number | null;
  accountName: string | null;
  /** The place's key (`placeKey`), for the forecast of a place; null for a Homey's. */
  placeKey: string | null;
  status: 'loading' | 'noLocation' | 'connected' | 'disconnected';
  error: string | null;
  /** The town Homey's own weather names, or the place's name. */
  place: string | null;
  /** Where the forecast is for, in degrees; absent until Homey says where it is. */
  location?: { latitude: number; longitude: number } | null;
  now: WeatherNow | null;
  /** The next 24 hours, from the current one. */
  hours: WeatherHour[];
  /** Today and the 6 days after. */
  days: WeatherDay[];
  rain: RainPoint[] | null;
  updatedAt: string | null;
}
