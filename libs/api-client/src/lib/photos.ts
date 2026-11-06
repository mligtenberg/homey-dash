import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { filter, switchMap, take, timer } from 'rxjs';

// Mirrors apps/api/Photos/PhotoEndpoints.cs.

/** One photo of a set, served from Immich at `photoUrl(set, photo)`. */
export interface Photo {
  /** Its asset id in Immich. */
  id: string;
  /** When it was taken, as Immich knows it. */
  takenAt: string | null;
  /** Where it was taken, such as "Utrecht, Netherlands", as Immich knows it. */
  place: string | null;
  /** Null until they are read. */
  faces: Faces | null;
  /** Changes when the photo is edited in Immich, such as rotated; null when Immich gives none. */
  version?: string | null;
  /** The Immich user whose photo it is, such as a partner of the set's account; null when synced before it was read. */
  ownerId?: string | null;
}

/** The faces Immich found in a photo. */
export interface Faces {
  /** What to keep in view when cropping it. */
  focus: Focus;
  /** The names of the people they are, from left to right. */
  people: string[];
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
  /** A sync someone asked for has not finished; `untilSynced` waits for it. */
  syncing: boolean;
  /** The dashboards whose draft shows it. */
  dashboards: string[];
  /** The ids of the photos excluded from it on a display, first excluded first; served at `photoUrl` too. */
  excluded: string[];
  /** The partners of its account without a key of their own, whose photos can't be rotated. */
  lockedOwners: string[];
}

/** Whether a display may rotate the photo in Immich: not when it is a partner's who gave no key. */
export function canRotate(set: Pick<PhotoSet, 'lockedOwners'>, photo: Pick<Photo, 'ownerId'>) {
  return !photo.ownerId || !set.lockedOwners.includes(photo.ownerId);
}

/** An album in Immich that a photo set can follow. */
export interface ImmichAlbum {
  id: string;
  name: string;
  /** Photos and videos. */
  assetCount: number;
}

/**
 * A side of an image HomeyDash resizes for a screen: css pixels at the screen's pixel density, rounded up so slightly
 * different sizes share an image, within what HomeyDash accepts.
 */
export function imageSide(css: number, density = globalThis.devicePixelRatio || 1) {
  return Math.min(4096, Math.max(16, Math.ceil((css * density) / 16) * 16));
}

/**
 * With the photo's version, so a photo edited in Immich is fetched again rather than taken from the cache. With a size
 * in css pixels, HomeyDash crops it to cover that box around the faces in it and sends no more pixels than the screen
 * has; its faces are read after it is synced, so they are part of the URL too.
 */
export function photoUrl(
  set: Pick<PhotoSet, 'id'>,
  photo: Pick<Photo, 'id'> & Partial<Pick<Photo, 'version' | 'faces'>>,
  size?: { width: number; height: number },
  density?: number,
) {
  const query = new URLSearchParams();
  if (photo.version) query.set('v', photo.version);
  if (size) {
    query.set('width', `${imageSide(size.width, density)}`);
    query.set('height', `${imageSide(size.height, density)}`);
    if (photo.faces) query.set('faces', '1');
  }
  const url = `/api/photos/${set.id}/${photo.id}`;
  return query.size ? `${url}?${query}` : url;
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

  get(id: string) {
    return this.http.get<PhotoSet>(`/api/photo-sets/${id}`);
  }

  /** Polls the set, every second, until a sync someone asked for has finished; then emits it once. */
  untilSynced(id: string) {
    return timer(0, 1000).pipe(
      switchMap(() => this.get(id)),
      filter((set) => !set.syncing),
      take(1),
    );
  }

  /** A set drawn by `selection`; it arrives while it draws in the background, see `untilSynced`. */
  createSelection(accountId: number, name: string, selection: PhotoSelection) {
    return this.http.post<PhotoSet>('/api/photo-sets', { accountId, name, selection });
  }

  /** Leave out what stays the same. Another album, selection or account syncs in the background, see `untilSynced`. */
  update(id: string, change: { name?: string; albumId?: string; selection?: PhotoSelection; accountId?: number }) {
    return this.http.patch<PhotoSet>(`/api/photo-sets/${id}`, change);
  }

  delete(id: string) {
    return this.http.delete<void>(`/api/photo-sets/${id}`);
  }

  /** Leaves a photo out of the set for good: no sync brings it back. Tiles showing the set move on. */
  exclude(set: Pick<PhotoSet, 'id'>, photo: Pick<Photo, 'id'>) {
    return this.http.put<PhotoSet>(`/api/photo-sets/${set.id}/excluded/${encodeURIComponent(photo.id)}`, null);
  }

  /**
   * Turns the photo in Immich a quarter turn, clockwise or the other way, and answers once Immich has turned it. Every set
   * with it then arrives with its new version, and its faces read again.
   */
  rotate(set: Pick<PhotoSet, 'id'>, photo: Pick<Photo, 'id'>, clockwise: boolean) {
    return this.http.post<PhotoSet>(`/api/photo-sets/${set.id}/photos/${encodeURIComponent(photo.id)}/rotate`, { degrees: clockwise ? 90 : -90 });
  }

  /**
   * Lets an excluded photo back into the set. An album syncs at once, so it is back if it is still in the album; a
   * selection draws it again only by chance.
   */
  restore(set: Pick<PhotoSet, 'id'>, photoId: string) {
    return this.http.delete<PhotoSet>(`/api/photo-sets/${set.id}/excluded/${encodeURIComponent(photoId)}`);
  }

  /** Syncs with the album, or draws again, now rather than at the next round, in the background: see `untilSynced`. */
  sync(id: string) {
    return this.http.post<PhotoSet>(`/api/photo-sets/${id}/sync`, null);
  }
}
