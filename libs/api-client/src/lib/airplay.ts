import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

/** An AirPlay receiver on the network. Only a `tv` plays what Plex streams, video or music (ADR-0012). */
export interface AirPlayDevice {
  id: string;
  name: string;
  kind: 'tv' | 'speaker' | 'computer';
  paired: boolean;
}

/**
 * What plays on a receiver because a screen started it, the same on every screen. `offsetMs` is where it was at `at`; while
 * not `paused` it moves on from there. The tracks are the choice made: null is Plex's default audio and no subtitle.
 */
export interface AirPlayPlayback {
  deviceId: string;
  deviceName: string;
  accountId: number;
  itemId: string;
  title: string;
  paused: boolean;
  audioStreamId: string | null;
  subtitleStreamId: string | null;
  offsetMs: number;
  at: string;
  /** What the title is part of, such as a track's artist, album and place in the album. */
  detail?: string | null;
  /** How long it runs; 0 when the server doesn't say. */
  durationMs?: number;
}

/** Whether AirPlay is set up, and the receivers found. What a screen asks for. */
export interface AirPlayInfo {
  available: boolean;
  devices: AirPlayDevice[];
}

/** What Management shows: whether AirPlay is on (or faked), looking for receivers worked, and the receivers it found. */
export interface AirPlayStatus {
  configured: boolean;
  fake: boolean;
  reachable: boolean;
  /** Why the service did not answer. */
  error: string | null;
  devices: AirPlayDevice[];
}

/** Looking at AirPlay's receivers, and pairing them (ADR-0012). */
@Injectable({ providedIn: 'root' })
export class AirPlayAccountApi {
  private readonly http = inject(HttpClient);

  /** Looking for receivers takes the service a few seconds. */
  status() {
    return this.http.get<AirPlayStatus>('/api/accounts/airplay');
  }

  /** Makes the receiver show a PIN. */
  startPairing(deviceId: string) {
    return this.http.post<void>(`/api/accounts/airplay/${encodeURIComponent(deviceId)}/pair`, {});
  }

  /** Pairs it with the PIN it shows; fails when the receiver does not accept it. */
  finishPairing(deviceId: string, pin: string) {
    return this.http.post<void>(`/api/accounts/airplay/${encodeURIComponent(deviceId)}/pair/finish`, { pin });
  }
}
