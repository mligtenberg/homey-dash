import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { PlexOverview, PlexSession, Realtime } from '@homey-dash/api-client';

/** A session as it arrived here: progress moves on from `receivedAt`, this browser's clock, while it plays. */
export interface LivePlexSession extends PlexSession {
  receivedAt: number;
}

/** Where a session is now, in milliseconds: playing moves on from where it was, and never past its end. */
export function plexPosition(session: LivePlexSession, now: number): number {
  const moved = session.state === 'playing' ? Math.max(0, now - session.receivedAt) : 0;
  return Math.min(session.offsetMs + moved, session.durationMs || Infinity);
}

/** 1:05:09 or 4:07. */
export function plexTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Plex as Plex tiles see it, from HomeyDash's realtime connection (ADR-0009): each account's status, libraries and
 * players (`Plex`) and what plays now on any of them (`PlexSessions`). A snapshot loads on every (re)connect.
 */
@Injectable({ providedIn: 'root' })
export class PlexData {
  private readonly realtime = inject(Realtime);

  /** Every account, oldest first; null until the first snapshot. */
  readonly overviews = signal<PlexOverview[] | null>(null);
  readonly sessions = signal<LivePlexSession[]>([]);

  constructor() {
    const stops = [
      this.realtime.on('Plex', (overviews) => this.overviews.set(overviews)),
      this.realtime.on('PlexSessions', (sessions) => this.setSessions(sessions)),
      this.realtime.whenConnected(() => this.load()),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  }

  /** A tile's account (`settings.account`), or the oldest when it names none; undefined when there is no such account. */
  overview(account: number | null | undefined): PlexOverview | undefined {
    const all = this.overviews();
    return account == null ? all?.[0] : all?.find((o) => o.accountId === account);
  }

  /** The account's status for `plexIdle`: not set up when it doesn't exist, unknown before the first snapshot. */
  status(account: number | null | undefined) {
    return this.overview(account)?.status ?? (this.overviews() ? 'notSetUp' : undefined);
  }

  private setSessions(sessions: PlexSession[]) {
    const now = Date.now();
    this.sessions.set(sessions.map((session) => ({ ...session, receivedAt: now })));
  }

  private async load() {
    try {
      const snapshot = await this.realtime.plex();
      this.overviews.set(snapshot.accounts);
      this.setSessions(snapshot.sessions);
    } catch {
      // The connection dropped again; the next reconnect loads it.
    }
  }
}
