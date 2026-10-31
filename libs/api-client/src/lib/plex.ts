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
}

/** Something newly added to a library. */
export interface PlexItem {
  id: string;
  kind: 'movie' | 'episode' | 'season' | 'album' | 'other';
  title: string;
  subtitle: string | null;
  image: string | null;
  addedAt: string;
}

export interface PlexLibrary {
  id: string;
  title: string;
  type: 'movie' | 'show' | 'artist';
  /** The newest first. */
  recent: PlexItem[];
}

/** A player that played something since HomeyDash started. */
export interface PlexPlayer {
  id: string;
  name: string;
}

/** Plex as tiles see it. `loaded` is false until the libraries first arrived; nothing is missing then. */
export interface PlexOverview {
  status: 'notSetUp' | 'choosingServer' | 'connected' | 'disconnected';
  error: string | null;
  loaded: boolean;
  libraries: PlexLibrary[];
  players: PlexPlayer[];
}

export interface PlexSnapshot {
  overview: PlexOverview;
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

/** A picture from the Plex server, scaled by it to fit `width` × `height`. */
export function plexImageUrl(path: string, width: number, height: number) {
  return `/api/plex/image?path=${encodeURIComponent(path)}&w=${Math.round(width)}&h=${Math.round(height)}`;
}

/** A sign-in waiting for someone to approve it at `authUrl`, or one that failed. */
export interface PlexSignInStatus {
  state: 'waiting' | 'failed';
  authUrl: string | null;
  error: string | null;
}

/** The Plex account. Its tokens never leave HomeyDash. */
export interface PlexAccountInfo {
  /** HomeyDash runs against a fake Plex, set in its configuration. */
  fake: boolean;
  signedIn: boolean;
  username: string | null;
  /** Null while someone has to choose one of the account's servers. */
  serverId: string | null;
  serverName: string | null;
  signIn: PlexSignInStatus | null;
}

export interface PlexServer {
  id: string;
  name: string;
  /** False for a server someone shared with the account. */
  owned: boolean;
}

/** Signing in with Plex, and choosing its server. */
@Injectable({ providedIn: 'root' })
export class PlexAccountApi {
  private readonly http = inject(HttpClient);

  get() {
    return this.http.get<PlexAccountInfo>('/api/accounts/plex');
  }

  /** Starts signing in: open `url`, Plex's own page, for someone to approve HomeyDash. */
  signIn() {
    return this.http.post<{ url: string }>('/api/accounts/plex/sign-in', null);
  }

  cancelSignIn() {
    return this.http.delete<void>('/api/accounts/plex/sign-in');
  }

  servers() {
    return this.http.get<PlexServer[]>('/api/accounts/plex/servers');
  }

  chooseServer(id: string) {
    return this.http.put<PlexAccountInfo>('/api/accounts/plex/server', { id });
  }

  signOut() {
    return this.http.delete<void>('/api/accounts/plex');
  }
}
