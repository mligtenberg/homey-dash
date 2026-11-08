import { apiProblem, ImmichAccount, ImmichAccountApi, ImmichAlbum, PhotoSetsApi } from '@homey-dash/api-client';
import { firstValueFrom } from 'rxjs';

/** One Immich account's albums, for a photo set to follow. */
export interface AlbumGroup {
  account: ImmichAccount;
  albums: ImmichAlbum[];
}

/**
 * Every Immich account's albums, oldest account first, or what went wrong, such as Immich not being set up. An account
 * whose Immich can't be reached is left out, and `error` says so.
 */
export async function loadAlbums(
  accounts: ImmichAccountApi,
  api: PhotoSetsApi,
): Promise<{ groups: AlbumGroup[]; error: string | null }> {
  let list: ImmichAccount[];
  try {
    list = (await firstValueFrom(accounts.list())).accounts;
  } catch (e) {
    return { groups: [], error: apiProblem(e, 'Could not load the Immich accounts. Try again.') };
  }
  if (!list.length) return { groups: [], error: 'Set up Immich under Accounts first.' };
  const loaded = await Promise.all(
    list.map(async (account) => {
      try {
        return { account, albums: await firstValueFrom(api.albums(account.id)) };
      } catch (e) {
        return apiProblem(e, `Could not load the albums from ${account.name}. Try again.`);
      }
    }),
  );
  const groups = loaded.filter((g): g is AlbumGroup => typeof g !== 'string');
  return { groups, error: loaded.find((g): g is string => typeof g === 'string') ?? null };
}

/** An album's option value, so one list can offer the albums of every account. */
export function albumValue(accountId: number, albumId: string) {
  return `${accountId}:${albumId}`;
}

export function parseAlbumValue(value: string): { accountId: number; albumId: string } | null {
  const at = value.indexOf(':');
  return at > 0 ? { accountId: Number(value.slice(0, at)), albumId: value.slice(at + 1) } : null;
}

/** An album as an option reads: "Summer (13)". */
export function albumLabel(album: ImmichAlbum) {
  return `${album.name} (${album.assetCount})`;
}
