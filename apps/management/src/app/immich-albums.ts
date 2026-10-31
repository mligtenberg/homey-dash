import { HttpErrorResponse } from '@angular/common/http';
import { ImmichAlbum, PhotoSetsApi } from '@homey-dash/api-client';
import { firstValueFrom } from 'rxjs';

/** Immich's albums for a photo set to follow, or what went wrong, such as Immich not being set up. */
export async function loadAlbums(api: PhotoSetsApi): Promise<ImmichAlbum[] | string> {
  try {
    return await firstValueFrom(api.albums());
  } catch (e) {
    return problem(e, 'Could not load the albums from Immich. Try again.');
  }
}

/** An album as an option reads: "Summer (13)". */
export function albumLabel(album: ImmichAlbum) {
  return `${album.name} (${album.assetCount})`;
}

/** The API's own explanation where it gave one, else the fallback. */
export function problem(e: unknown, fallback: string): string {
  if (!(e instanceof HttpErrorResponse)) return fallback;
  const errors = e.error?.errors as Record<string, string[]> | undefined;
  return (errors && Object.values(errors)[0]?.[0]) ?? (typeof e.error?.detail === 'string' ? e.error.detail : fallback);
}
