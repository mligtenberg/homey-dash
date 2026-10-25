import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DashboardLayout } from './dashboards';

// Mirrors apps/api/Displays/Display.cs.

export interface DisplaySummary {
  id: string;
  name: string;
  dashboardId: string | null;
}

/** The published version a display shows. */
export interface ShownDashboard {
  id: string;
  name: string;
  version: number;
  layout: DashboardLayout;
}

/** Which display a screen is, and what it shows (null while waiting for a dashboard). */
export interface ScreenView {
  display: DisplaySummary;
  dashboard: ShownDashboard | null;
}

/**
 * Displays, for setup on a screen and for assignment in Management. A screen is known by the id it keeps in
 * localStorage; asking for a screen that holds no display answers 404, which sends it to setup.
 */
@Injectable({ providedIn: 'root' })
export class DisplaysApi {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<DisplaySummary[]>('/api/displays');
  }

  setUp(name: string, screenId: string) {
    return this.http.post<DisplaySummary>('/api/displays', { name, screenId });
  }

  takeOver(id: string, screenId: string) {
    return this.http.post<DisplaySummary>(`/api/displays/${id}/takeover`, { screenId });
  }

  rename(id: string, name: string) {
    return this.http.patch<DisplaySummary>(`/api/displays/${id}`, { name });
  }

  assign(id: string, dashboardId: string | null) {
    return this.http.put<DisplaySummary>(`/api/displays/${id}/dashboard`, { dashboardId });
  }

  delete(id: string) {
    return this.http.delete<void>(`/api/displays/${id}`);
  }

  screen(screenId: string) {
    return this.http.get<ScreenView>(`/api/screens/${screenId}`);
  }
}
