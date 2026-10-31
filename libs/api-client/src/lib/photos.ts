import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

// Mirrors apps/api/Photos/PhotoEndpoints.cs.

/** One photo of a set, served from Immich at `photoUrl(set, photo)`. */
export interface Photo {
  /** Its asset id in Immich. */
  id: string;
  /** When it was taken, as Immich knows it. */
  takenAt: string | null;
  /** What to keep in view when cropping it; null until its faces are read. */
  focus: Focus | null;
}

/**
 * The middle of the faces in a photo, as fractions of its width and height from the top left; the photo's middle when
 * Immich found none.
 */
export interface Focus {
  x: number;
  y: number;
}

/** Someone Immich recognises by their face. */
export interface PersonRef {
  id: string;
  name: string;
}

/**
 * Photos drawn at random from Immich: `count` of them, showing at least one of `with` (anyone when empty) and none of
 * `without`, matching `query` by what is in them when set, such as "landscape". Drawn again every `refreshHours`, or
 * only when asked when that is 0.
 */
export interface PhotoSelection {
  with: PersonRef[];
  without: PersonRef[];
  query: string | null;
  count: number;
  refreshHours: number;
}

export const SELECTION_MAX_COUNT = 1000;

/** How often a selection can be drawn again, in hours; 0 is only when asked. */
export const SELECTION_REFRESH: readonly { hours: number; label: string }[] = [
  { hours: 1, label: 'Every hour' },
  { hours: 6, label: 'Every 6 hours' },
  { hours: 24, label: 'Every day' },
  { hours: 168, label: 'Every week' },
  { hours: 0, label: 'Only when I ask' },
];

/** A set of photos that follows an Immich album, or is drawn at random from Immich by a selection. */
export interface PhotoSet {
  id: string;
  name: string;
  /** What a photo tile stores as its target. */
  target: string;
  /** The Immich account it draws from; both null once that account is removed. */
  accountId: number | null;
  accountName: string | null;
  /** Null for a selection. */
  albumId: string | null;
  /** The album's name in Immich when it last synced. */
  albumName: string;
  /** Null for an album. */
  selection: PhotoSelection | null;
  photos: Photo[];
  syncedAt: string | null;
  /** Videos in the album, which a photo set leaves out. */
  skippedVideos: number;
  /** Why the last sync with Immich failed; the photos are then those of the sync before. */
  syncError: string | null;
  /** The dashboards whose draft shows it. */
  dashboards: string[];
}

/** An album in Immich that a photo set can follow. */
export interface ImmichAlbum {
  id: string;
  name: string;
  /** Photos and videos. */
  assetCount: number;
}

export function photoUrl(set: Pick<PhotoSet, 'id'>, photo: Pick<Photo, 'id'>) {
  return `/api/photos/${set.id}/${photo.id}`;
}

@Injectable({ providedIn: 'root' })
export class PhotoSetsApi {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<PhotoSet[]>('/api/photo-sets');
  }

  /** The albums in an Immich account, by name. */
  albums(accountId: number) {
    return this.http.get<ImmichAlbum[]>(`/api/accounts/immich/${accountId}/albums`);
  }

  /** The people with a name in an Immich account, by name. */
  people(accountId: number) {
    return this.http.get<PersonRef[]>(`/api/accounts/immich/${accountId}/people`);
  }

  /** Leave `name` empty to take the album's. The set arrives with the album's photos. */
  create(accountId: number, albumId: string, name?: string) {
    return this.http.post<PhotoSet>('/api/photo-sets', { accountId, albumId, name: name || null });
  }

  /** A set drawn by `selection`; it arrives with its first draw. */
  createSelection(accountId: number, name: string, selection: PhotoSelection) {
    return this.http.post<PhotoSet>('/api/photo-sets', { accountId, name, selection });
  }

  /** Leave out what stays the same. Another album, selection or account syncs at once. */
  update(id: string, change: { name?: string; albumId?: string; selection?: PhotoSelection; accountId?: number }) {
    return this.http.patch<PhotoSet>(`/api/photo-sets/${id}`, change);
  }

  delete(id: string) {
    return this.http.delete<void>(`/api/photo-sets/${id}`);
  }

  /** Syncs with the album, or draws again, now rather than at the next round. */
  sync(id: string) {
    return this.http.post<PhotoSet>(`/api/photo-sets/${id}/sync`, null);
  }
}
