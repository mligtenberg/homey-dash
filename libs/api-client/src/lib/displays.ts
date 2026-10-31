import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DashboardLayout } from './dashboards';

// Mirrors apps/api/Displays/Display.cs.

/** A display, its main dashboard and the others it can switch to, in the order it offers them. */
export interface DisplaySummary {
  id: string;
  name: string;
  /** The main dashboard, which it returns to when left alone; null while it waits for one. */
  dashboardId: string | null;
  otherDashboardIds: string[];
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
  /** One per assigned dashboard, main first. */
  versions: DashboardVersion[];
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

/** Which display a screen is, and the dashboards it offers, main first (none while waiting for one). */
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

  /** Assigns the main dashboard and the others the display can switch to; others need a main one. */
  assign(id: string, dashboardId: string | null, otherDashboardIds: string[] = []) {
    return this.http.put<DisplayInfo>(`/api/displays/${id}/dashboard`, { dashboardId, otherDashboardIds });
  }

  delete(id: string) {
    return this.http.delete<void>(`/api/displays/${id}`);
  }

  screen(screenId: string) {
    return this.http.get<ScreenView>(`/api/screens/${screenId}`);
  }
}
