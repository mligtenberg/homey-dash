import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { TilePosition, TileSize } from '@homey-dash/layout';
import { Rule } from './rules';

// Mirrors apps/api/Dashboards/DashboardModels.cs.

export interface Tile<TSettings = unknown> {
  id: string;
  kind: string;
  size: TileSize;
  position: TilePosition;
  settings: TSettings;
}

export interface Section {
  id: string;
  title: string;
  tiles: Tile[];
  /** Shown in the editor, left out on displays. */
  hidden?: boolean;
  /** When set, displays show it only while this holds (ADR-0010). */
  rule?: Rule | null;
}

/** A dashboard version, draft or published. */
export interface DashboardLayout {
  rows: number;
  sections: Section[];
}

export interface DashboardSummary {
  id: string;
  name: string;
  /** Counts publishes; 0 means never published. */
  publishedVersion: number;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  /** Tiles in the draft whose target Homey does not have; 0 while Homey is not loaded. */
  missingTiles: number;
}

export interface DashboardDetail extends DashboardSummary {
  draft: DashboardLayout;
  published: DashboardLayout | null;
}

/** Dashboards as Management builds them. A draft that breaks the layout rules is refused with a 400. */
@Injectable({ providedIn: 'root' })
export class DashboardsApi {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<DashboardSummary[]>('/api/dashboards');
  }

  get(id: string) {
    return this.http.get<DashboardDetail>(`/api/dashboards/${id}`);
  }

  create(name: string) {
    return this.http.post<DashboardDetail>('/api/dashboards', { name });
  }

  rename(id: string, name: string) {
    return this.http.patch<DashboardDetail>(`/api/dashboards/${id}`, { name });
  }

  delete(id: string) {
    return this.http.delete<void>(`/api/dashboards/${id}`);
  }

  saveDraft(id: string, draft: DashboardLayout) {
    return this.http.put<DashboardDetail>(`/api/dashboards/${id}/draft`, draft);
  }

  publish(id: string) {
    return this.http.post<DashboardDetail>(`/api/dashboards/${id}/publish`, null);
  }
}
