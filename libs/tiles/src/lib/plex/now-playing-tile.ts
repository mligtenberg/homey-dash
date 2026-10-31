import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { ANY_PLEX_PLAYER, PlexCommand, plexImageUrl, Realtime } from '@homey-dash/api-client';
import { LucideDynamicIcon, LucidePause, LucidePlay, LucideSkipBack, LucideSkipForward, LucideTv } from '@lucide/angular';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';
import { LivePlexSession, PlexData, plexPosition, plexTime } from './plex-data';

/** How long a tile following any player shows one of several sessions before the next. */
export const NOW_PLAYING_CYCLE_MS = 12_000;

/** What a tile says while it shows nothing, from Plex's status. */
export function plexIdle(status: string | undefined, error: string | null | undefined): string {
  switch (status) {
    case 'notSetUp':
      return 'Plex is not set up';
    case 'choosingServer':
      return 'Choose a Plex server';
    case 'disconnected':
      return error ?? 'Cannot reach Plex';
    case 'connected':
      return 'Nothing playing';
    default:
      return '…';
  }
}

/**
 * What plays on a player of the tile's Plex account, or on any of them (`plex-player:any`), over its artwork: title, who watches where, progress, and
 * buttons to skip back, play or pause, and skip on. With several sessions, a tile following any player moves through
 * them. A press opens the detail view with every session it follows. Buttons only work for players that take remote
 * control; the tile flashes when one refuses.
 */
@Component({
  selector: 'hd-plex-now-playing-tile',
  imports: [TileDetails, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-plex', '[class.has-art]': '!!session()' },
  template: `
    @if (session(); as session) {
      @if (artUrl(session); as art) {
        <img class="hd-plex__art" [src]="art" alt="" draggable="false" />
      }
      <div class="hd-plex__body">
        <div class="hd-plex__titles">
          <div class="hd-plex__title">{{ settings().label || session.title }}</div>
          @if (session.subtitle && size() !== 'small') {
            <div class="hd-plex__sub">{{ session.subtitle }}</div>
          }
          @if (size() === 'large' || size() === 'full-large') {
            <div class="hd-plex__sub">{{ who(session) }}</div>
          }
        </div>
        <div class="hd-plex__controls">
          @if (size() !== 'small') {
            <span class="hd-plex__time">{{ time(session) }}</span>
          }
          <div class="hd-round-btns">
            @if (size() !== 'small') {
              <button type="button" class="hd-round-btn" aria-label="Skip back" (click)="control(session, 'skipPrevious')">
                <svg [lucideIcon]="backIcon" />
              </button>
            }
            <button
              type="button"
              class="hd-round-btn"
              [attr.aria-label]="session.state === 'playing' ? 'Pause' : 'Play'"
              (click)="control(session, session.state === 'playing' ? 'pause' : 'play')"
            >
              <svg [lucideIcon]="session.state === 'playing' ? pauseIcon : playIcon" />
            </button>
            @if (size() !== 'small') {
              <button type="button" class="hd-round-btn" aria-label="Skip forward" (click)="control(session, 'skipNext')">
                <svg [lucideIcon]="forwardIcon" />
              </button>
            }
          </div>
        </div>
      </div>
      <div class="hd-plex__progress" role="progressbar" [attr.aria-valuenow]="percent(session)" aria-valuemin="0" aria-valuemax="100">
        <div class="hd-plex__progress-fill" [style.width.%]="percent(session)"></div>
      </div>
    } @else {
      <svg class="hd-icon" [lucideIcon]="tvIcon" />
      <div>
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
    <hd-tile-details [name]="face().name" [icon]="tvIcon" [subtitle]="detailsSubtitle()">
      @for (item of sessions(); track item.id) {
        <div class="hd-plex-details__row">
          @if (item.image) {
            <img class="hd-plex-details__poster" [src]="posterUrl(item, item.image)" alt="" draggable="false" />
          }
          <div class="hd-plex-details__info">
            <div class="hd-details__label">{{ item.title }}</div>
            @if (item.subtitle) {
              <div class="hd-plex__sub">{{ item.subtitle }}</div>
            }
            <div class="hd-plex__sub">{{ who(item) }}</div>
            <div class="hd-plex__progress hd-plex__progress--inline">
              <div class="hd-plex__progress-fill" [style.width.%]="percent(item)"></div>
            </div>
            <span class="hd-plex__time">{{ time(item) }}</span>
          </div>
          <div class="hd-round-btns">
            <button type="button" class="hd-round-btn" [attr.aria-label]="'Skip back on ' + item.playerName" (click)="control(item, 'skipPrevious')">
              <svg [lucideIcon]="backIcon" />
            </button>
            <button
              type="button"
              class="hd-round-btn"
              [attr.aria-label]="(item.state === 'playing' ? 'Pause ' : 'Play ') + item.playerName"
              (click)="control(item, item.state === 'playing' ? 'pause' : 'play')"
            >
              <svg [lucideIcon]="item.state === 'playing' ? pauseIcon : playIcon" />
            </button>
            <button type="button" class="hd-round-btn" [attr.aria-label]="'Skip forward on ' + item.playerName" (click)="control(item, 'skipNext')">
              <svg [lucideIcon]="forwardIcon" />
            </button>
          </div>
        </div>
      } @empty {
        <p class="hd-details__label">Nothing playing</p>
      }
      @if (flash() === 'error') {
        <p class="hd-plex-details__error" role="alert">The player didn't take it. Turn on Advertise as player in its Plex settings.</p>
      }
    </hd-tile-details>
  `,
})
export class NowPlayingTile extends TileView {
  private readonly plex = inject(PlexData);
  private readonly realtime = inject(Realtime);

  protected readonly tvIcon = LucideTv;
  protected readonly playIcon = LucidePlay;
  protected readonly pauseIcon = LucidePause;
  protected readonly backIcon = LucideSkipBack;
  protected readonly forwardIcon = LucideSkipForward;

  private readonly overview = computed(() => this.plex.overview(this.settings().account));

  /** The sessions this tile follows on its account: one player's, or every one. */
  protected readonly sessions = computed(() => {
    const target = this.settings().target;
    const accountId = this.overview()?.accountId;
    const sessions = this.plex.sessions().filter((s) => s.accountId === accountId);
    if (!target || target === ANY_PLEX_PLAYER) return sessions;
    return sessions.filter((s) => `plex-player:${s.playerId}` === target);
  });

  private readonly index = signal(0);
  protected readonly session = computed<LivePlexSession | undefined>(() => {
    const sessions = this.sessions();
    return sessions.length ? sessions[this.index() % sessions.length] : undefined;
  });

  /** Ticks every second while something plays, so progress moves. */
  private readonly now = signal(Date.now());

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideTv, hue: 'neutral' as const };
    const label = this.settings().label;
    const session = this.session();
    const overview = this.overview();
    const status = this.plex.status(this.settings().account);
    if (!this.settings().target) return { ...look, name: label || 'Now playing', detail: 'Pick a player', state: 'unset' };
    if (session) return { ...look, name: label || session.title, detail: session.subtitle ?? '', details: true, state: 'ok' };
    const player = overview?.players.find((p) => `plex-player:${p.id}` === this.settings().target);
    return {
      ...look,
      name: label || player?.name || 'Plex',
      detail: plexIdle(status, overview?.error),
      state: status === 'connected' || !status ? 'ok' : 'unavailable',
    };
  });

  protected readonly detailsSubtitle = computed(() => {
    const count = this.sessions().length;
    return count === 1 ? '1 playing' : `${count} playing`;
  });

  constructor() {
    super();
    const ticker = setInterval(() => {
      if (this.sessions().some((s) => s.state === 'playing')) this.now.set(Date.now());
    }, 1000);
    const cycler = setInterval(() => {
      if (this.sessions().length > 1) this.index.update((i) => i + 1);
    }, NOW_PLAYING_CYCLE_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(ticker);
      clearInterval(cycler);
    });
    // Starts over with the first when sessions start or end, not when one pauses.
    const ids = computed(() => this.sessions().map((s) => s.id).join());
    effect(() => {
      ids();
      this.index.set(0);
    });
  }

  protected percent(session: LivePlexSession) {
    return session.durationMs ? Math.round((plexPosition(session, this.now()) / session.durationMs) * 1000) / 10 : 0;
  }

  protected time(session: LivePlexSession) {
    const position = plexTime(plexPosition(session, this.now()));
    return session.durationMs ? `${position} / ${plexTime(session.durationMs)}` : position;
  }

  protected who(session: LivePlexSession) {
    return [session.user, session.playerName].filter(Boolean).join(' · ');
  }

  // Wide artwork for wide tiles, the poster for square ones; scaled to about the tile's size.
  protected artUrl(session: LivePlexSession) {
    const wide = this.size() === 'wide' || this.size() === 'full' || this.size() === 'full-large';
    const path = (wide ? session.art : null) ?? session.image ?? session.art;
    return path ? plexImageUrl(session.accountId, path, wide ? 1280 : 720, 720) : null;
  }

  protected posterUrl(session: LivePlexSession, path: string) {
    return plexImageUrl(session.accountId, path, 200, 300);
  }

  protected control(session: LivePlexSession, command: PlexCommand) {
    this.send(() => this.realtime.controlPlex(session.accountId, session.playerId, command), 'quiet');
  }
}
