import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { PlaceMatch } from './weather';

// Mirrors apps/api/Traffic (ADR-0015).

/** A place of a route: its name and where it is, in degrees. */
export interface TrafficPlace {
  name: string;
  latitude: number;
  longitude: number;
}

/** A route a traffic tile (`settings.route`) or lock screen widget (`route`) shows. */
export interface TrafficRoute {
  name: string;
  origin: TrafficPlace;
  destination: TrafficPlace;
}

/** The key the traffic of a route goes by: routes with the same places, to three decimals, share it. */
export function routeKey(route: Pick<TrafficRoute, 'origin' | 'destination'>): string {
  const at = (p: TrafficPlace) => `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;
  return `${at(route.origin)}>${at(route.destination)}`;
}

/**
 * The traffic on one route now, from TomTom. Times are seconds. `status` is `noAccount` without a TomTom account, and
 * `disconnected` when TomTom can't be reached (the last result stays).
 */
export interface RouteTraffic {
  routeKey: string;
  status: 'loading' | 'noAccount' | 'connected' | 'disconnected';
  error: string | null;
  /** By car, leaving now, with the traffic now. */
  travelSeconds: number | null;
  /** By car at this hour, from the history. */
  usualSeconds: number | null;
  /** How much longer than usual it takes now; 0 when it is not longer. */
  delaySeconds: number | null;
  distanceMeters: number | null;
  /** When leaving now arrives. */
  arrival: string | null;
  updatedAt: string | null;
}

/** A TomTom account. Its key never leaves HomeyDash. */
export interface TomTomAccount {
  id: number;
  /** Tells a home's TomTom accounts apart. */
  name: string;
}

export interface TomTomAccounts {
  /** HomeyDash runs against a fake TomTom, set in its configuration, whose one account can't be changed. */
  fake: boolean;
  /** Oldest first; a route uses the first unless it names another. */
  accounts: TomTomAccount[];
}

/** Setting up the TomTom accounts, and finding places by name. */
@Injectable({ providedIn: 'root' })
export class TomTomAccountApi {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<TomTomAccounts>('/api/accounts/tomtom');
  }

  /** TomTom checks the key before it is kept. */
  add(name: string, apiKey: string) {
    return this.http.post<TomTomAccounts>('/api/accounts/tomtom', { name, apiKey });
  }

  /** A new key is checked first. Leave `apiKey` empty to keep the current key. */
  update(id: number, name: string, apiKey: string) {
    return this.http.put<TomTomAccounts>(`/api/accounts/tomtom/${id}`, { name, apiKey: apiKey || null });
  }

  /** Tiles and widgets that name it show no traffic until they are given another account. */
  remove(id: number) {
    return this.http.delete<TomTomAccounts>(`/api/accounts/tomtom/${id}`);
  }
}

@Injectable({ providedIn: 'root' })
export class TrafficApi {
  private readonly http = inject(HttpClient);

  /** Places whose name starts with `query` (from two letters), best first, found with the account's key (the oldest without one). */
  places(query: string, language: string, account?: number | null) {
    const params: Record<string, string> = { query, language };
    if (account != null) params['account'] = String(account);
    return this.http.get<PlaceMatch[]>('/api/traffic/places', { params });
  }
}
