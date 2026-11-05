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

/**
 * What a dashboard shows behind its tiles: one colour, a gradient between two at an angle (as in CSS: 0 upwards, 90 to
 * the right), an image uploaded to HomeyDash, or one of the built-in images the apps ship, named `<style>/<subject>`,
 * drawn by day and by night, in its own colours or recoloured from a colour and the angle to a second one around the hue
 * wheel (the third and fourth opposite those). Colours are `#rrggbb`.
 */
export type DashboardBackground =
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; color: string; to: string; angle: number }
  | { kind: 'image'; imageId: string }
  | { kind: 'preset'; preset: string; color?: string | null; angle?: number | null };

/** Where HomeyDash serves an uploaded background image. */
export function backgroundImageUrl(imageId: string) {
  return `/api/backgrounds/${imageId}`;
}

/** Where the apps serve a built-in background, such as `geometric/living-room`, by day or by night. */
export function backgroundPresetUrl(preset: string, variant: 'day' | 'night') {
  return `/backgrounds/${preset}-${variant}.svg`;
}

/** A dashboard version, draft or published. */
export interface DashboardLayout {
  rows: number;
  sections: Section[];
  /** Absent or null: the theme's own ground. */
  background?: DashboardBackground | null;
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

  /** Uploads a JPEG, PNG or WebP image (at most 15 MB) to be a background; answers its id. */
  uploadBackground(file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ id: string; url: string }>('/api/backgrounds', form);
  }

  publish(id: string) {
    return this.http.post<DashboardDetail>(`/api/dashboards/${id}/publish`, null);
  }
}
