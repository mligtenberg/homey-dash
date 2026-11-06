import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DashboardLayout } from './dashboards';
import { Rule } from './rules';

// Mirrors apps/api/Displays/Display.cs.

/**
 * A rule and what a display left alone does while it holds: show one of its dashboards, or play a photo set full
 * screen or fill the screen with a colour until it is touched, which goes back to `returnDashboardId`, or to the
 * dashboard it showed last without it.
 */
export interface IdleRule {
  rule: Rule;
  /** The dashboard it shows; null when it plays a photo set or fills with a colour. */
  dashboardId: string | null;
  photoSetId?: string | null;
  /** The colour it fills the screen with, as `#rrggbb`. */
  color?: string | null;
  /** Whether it turns the screen off (black where the browser can't) instead. */
  screenOff?: boolean;
  returnDashboardId?: string | null;
}

/** Where on its lock screen a display shows a widget. */
export type LockSpot = 'top-left' | 'top-right' | 'center' | 'bottom-left' | 'bottom-right';

export const LOCK_SPOTS: readonly LockSpot[] = ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'];

/**
 * Something a display shows on its lock screen, over the photo set or colour an idle rule plays: the time and date,
 * the weather where a Homey is (of `account`, or the oldest), or the value of a device's capability, named by its
 * Homey signal (`homey:<account>:capability:<device>:<capability>`). Widgets in the same spot stack in order.
 */
export type LockWidget =
  | { kind: 'clock'; spot: LockSpot }
  | { kind: 'weather'; spot: LockSpot; account?: number | null }
  | { kind: 'value'; spot: LockSpot; signal: string };

/**
 * A display, the dashboards it offers in that order, the rules that choose which it shows when left alone, and what
 * its lock screen shows.
 */
export interface DisplaySummary {
  id: string;
  name: string;
  /** It starts on the first; none while it waits for one. */
  dashboardIds: string[];
  /** In order: left alone, it does what the first of these whose rule holds says, else stays where it is. */
  idleRules: IdleRule[];
  /** In order; at most 8. */
  lockWidgets: LockWidget[];
}

/**
 * Which published version of one of its dashboards a display shows. It is on the latest version when
 * `shownVersion` equals `latestVersion`.
 */
export interface DashboardVersion {
  dashboardId: string;
  shownVersion: number | null;
  latestVersion: number;
}

/** What Management knows about a display beyond its configuration. */
export interface DisplayStatus {
  connected: boolean;
  /** False once its screen was given to another display; a screen in setup can take it over. */
  held: boolean;
  lastSeenAt: string | null;
  /** One per dashboard it offers, in order. */
  versions: DashboardVersion[];
  /** Whether its screen runs in Fully Kiosk Browser. */
  kiosk: boolean;
  /** The light falling on its screen in lux, as it last measured; null until it has. */
  lux: number | null;
}

/** A display as Management lists it. */
export interface DisplayInfo extends DisplaySummary {
  status: DisplayStatus;
}

/** The published version a display shows. */
export interface ShownDashboard {
  id: string;
  name: string;
  version: number;
  layout: DashboardLayout;
}

/** Which display a screen is, and the dashboards it offers, in order (none while waiting for one). */
export interface ScreenView {
  display: DisplaySummary;
  dashboards: ShownDashboard[];
}

/**
 * Displays, for setup on a screen and for assignment in Management. A screen is known by the id it keeps in
 * localStorage; asking for a screen that holds no display answers 404, which sends it to setup.
 */
@Injectable({ providedIn: 'root' })
export class DisplaysApi {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<DisplayInfo[]>('/api/displays');
  }

  setUp(name: string, screenId: string) {
    return this.http.post<DisplaySummary>('/api/displays', { name, screenId });
  }

  takeOver(id: string, screenId: string) {
    return this.http.post<DisplayInfo>(`/api/displays/${id}/takeover`, { screenId });
  }

  rename(id: string, name: string) {
    return this.http.patch<DisplayInfo>(`/api/displays/${id}`, { name });
  }

  /** Assigns the dashboards the display offers, in order; none makes it wait. */
  assign(id: string, dashboardIds: string[]) {
    return this.http.put<DisplayInfo>(`/api/displays/${id}/dashboards`, { dashboardIds });
  }

  /** Replaces the rules that choose what it shows when left alone; each names a dashboard it offers or a photo set. */
  setIdleRules(id: string, rules: IdleRule[]) {
    return this.http.put<DisplayInfo>(`/api/displays/${id}/idle-rules`, { rules });
  }

  /** Replaces what its lock screen shows. */
  setLockScreen(id: string, widgets: LockWidget[]) {
    return this.http.put<DisplayInfo>(`/api/displays/${id}/lock-screen`, { widgets });
  }

  delete(id: string) {
    return this.http.delete<void>(`/api/displays/${id}`);
  }

  screen(screenId: string) {
    return this.http.get<ScreenView>(`/api/screens/${screenId}`);
  }
}
