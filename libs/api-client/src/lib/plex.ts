import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

// Mirrors apps/api/Plex.

/** Something playing on a Plex player now. While `state` is playing, `offsetMs` moves on from `at`. */
export interface PlexSession {
  id: string;
  kind: 'movie' | 'episode' | 'track' | 'other';
  title: string;
  /** A movie's year, an episode's show and number, a track's artist and album. */
  subtitle: string | null;
  /** A poster or cover, for `plexImageUrl`. */
  image: string | null;
  /** Wide background artwork, for `plexImageUrl`. */
  art: string | null;
  durationMs: number;
  offsetMs: number;
  at: string;
  state: 'playing' | 'paused' | 'buffering';
  /** Who is watching or listening. */
  user: string | null;
  playerId: string;
  playerName: string;
  /** The account whose server plays it. */
  accountId: number;
}

/**
 * Something in a library: newly added, found by a search, or listed under a show, season or album. `addedAt` is the epoch when
 * the server doesn't say.
 */
export interface PlexItem {
  id: string;
  kind: 'movie' | 'show' | 'episode' | 'season' | 'album' | 'track' | 'other';
  title: string;
  subtitle: string | null;
  image: string | null;
  addedAt: string;
  /** What the detail view of a cover shows, when the server has it. */
  summary?: string | null;
  year?: number | null;
  durationMs?: number | null;
  /** Out of ten. */
  rating?: number | null;
  contentRating?: string | null;
  genres?: string[];
  /** The wide artwork behind it. */
  art?: string | null;
  /** A film or episode that was played, or a season or series whose episodes all were. */
  watched?: boolean;
  /** An episode's, season's or track's number in its season, show or album; only on what `plexChildren` lists. */
  index?: number | null;
}

/** An audio or subtitle track of a movie or episode: `label` says language, format and channels. */
export interface PlexTrack {
  id: string;
  label: string;
  /** The one Plex plays when asked for none in particular. */
  selected: boolean;
}

export interface PlexTracks {
  audio: PlexTrack[];
  subtitles: PlexTrack[];
}

export interface PlexLibrary {
  id: string;
  title: string;
  type: 'movie' | 'show' | 'artist';
  /** The newest first. */
  recent: PlexItem[];
  /** How many films, series or albums it holds. */
  count?: number;
  /** The newest films, series or albums, newest first, where `recent` has what the server lists as new: for series, episodes. */
  titles?: PlexItem[];
}

/** A page of what a library holds: `total` is how many it holds in all. */
export interface PlexPage {
  items: PlexItem[];
  total: number;
}

/** A player that played something since HomeyDash started. */
export interface PlexPlayer {
  id: string;
  name: string;
}

/**
 * One Plex account as tiles see it. `loaded` is false until the libraries first arrived; nothing is missing then.
 */
export interface PlexOverview {
  accountId: number;
  accountName: string;
  status: 'notSetUp' | 'choosingServer' | 'connected' | 'disconnected';
  error: string | null;
  loaded: boolean;
  libraries: PlexLibrary[];
  players: PlexPlayer[];
}

/** Every Plex account, oldest first, and what plays on any of them. */
export interface PlexSnapshot {
  accounts: PlexOverview[];
  sessions: PlexSession[];
}

export type PlexCommand = 'play' | 'pause' | 'skipNext' | 'skipPrevious';

/** A now-playing tile's target that follows whatever plays. */
export const ANY_PLEX_PLAYER = 'plex-player:any';
/** A recently-added tile's target that shows every library. */
export const ALL_PLEX_LIBRARIES = 'plex-library:all';

export function plexPlayerTarget(player: Pick<PlexPlayer, 'id'>) {
  return `plex-player:${player.id}`;
}

export function plexLibraryTarget(library: Pick<PlexLibrary, 'id'>) {
  return `plex-library:${library.id}`;
}

/** A picture from a Plex account's server, scaled by it to fit `width` × `height`. */
export function plexImageUrl(accountId: number, path: string, width: number, height: number) {
  return `/api/plex/image?account=${accountId}&path=${encodeURIComponent(path)}&w=${Math.round(width)}&h=${Math.round(height)}`;
}

/** A track's own file, or a show's theme song (`theme`), from a Plex account's server through HomeyDash, for an audio element. */
export function plexAudioUrl(accountId: number, itemId: string, theme = false) {
  return `/api/plex/audio?account=${accountId}&item=${encodeURIComponent(itemId)}${theme ? '&theme=true' : ''}`;
}

/**
 * A sign-in waiting for someone to approve it at `authUrl`, or one that failed. `accountId` is the account signed in
 * again, null for a new one that will be called `name`.
 */
export interface PlexSignInStatus {
  state: 'waiting' | 'failed';
  authUrl: string | null;
  error: string | null;
  accountId: number | null;
  name: string;
}

/** A Plex account. Its tokens never leave HomeyDash. */
export interface PlexAccount {
  id: number;
  /** Tells a home's Plex accounts apart, such as which server it shows. */
  name: string;
  username: string | null;
  /** Null while someone has to choose one of the account's servers. */
  serverId: string | null;
  serverName: string | null;
}

export interface PlexAccounts {
  /** HomeyDash runs against a fake Plex, set in its configuration, whose one account can't be changed. */
  fake: boolean;
  /** Oldest first; a Plex tile shows the first unless its settings name another. */
  accounts: PlexAccount[];
  signIn: PlexSignInStatus | null;
}

export interface PlexServer {
  id: string;
  name: string;
  /** False for a server someone shared with the account. */
  owned: boolean;
}

/** Signing in with Plex, and choosing each account's server. Changes answer with every account. */
@Injectable({ providedIn: 'root' })
export class PlexAccountApi {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<PlexAccounts>('/api/accounts/plex');
  }

  /**
   * Starts signing in a new account called `name`, or again the account `accountId`, which keeps its tiles: open
   * `url`, Plex's own page, for someone to approve HomeyDash.
   */
  signIn(change: { name: string } | { accountId: number }) {
    return this.http.post<{ url: string }>('/api/accounts/plex/sign-in', change);
  }

  cancelSignIn() {
    return this.http.delete<void>('/api/accounts/plex/sign-in');
  }

  rename(id: number, name: string) {
    return this.http.put<PlexAccounts>(`/api/accounts/plex/${id}`, { name });
  }

  servers(id: number) {
    return this.http.get<PlexServer[]>(`/api/accounts/plex/${id}/servers`);
  }

  chooseServer(id: number, serverId: string) {
    return this.http.put<PlexAccounts>(`/api/accounts/plex/${id}/server`, { id: serverId });
  }

  /** Its Plex tiles show Plex as not set up until they are given another account. */
  remove(id: number) {
    return this.http.delete<PlexAccounts>(`/api/accounts/plex/${id}`);
  }
}
