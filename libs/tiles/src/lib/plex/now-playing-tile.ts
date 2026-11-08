import { brokenImages } from '../core/loadable-art';
import { Transport } from '../core/transport';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { ANY_PLEX_PLAYER, PlexCommand, plexImageUrl } from '@homey-dash/api-client';
import { LucideDynamicIcon } from '@lucide/angular';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace } from '../core/tile-view';
import { PlexTileView } from './plex-tile-view';
import { LivePlexSession, plexIdle, plexPosition, plexTime } from './plex-data';
import { LucideTv, clock } from '@homey-dash/design-system';
import { isLandscape } from '@homey-dash/layout';

/** How long a tile following any player shows one of several sessions before the next. */
export const NOW_PLAYING_CYCLE_MS = 12_000;

/**
 * What plays on a player of the tile's Plex account, or on any of them (`plex-player:any`), over its artwork: title, who watches where, progress, and
 * buttons to skip back, play or pause, and skip on. With several sessions, a tile following any player moves through
 * them. A press opens the detail view with every session it follows. Buttons only work for players that take remote
 * control; the tile flashes when one refuses.
 */
@Component({
  selector: 'hd-plex-now-playing-tile',
  imports: [TileDetails, LucideDynamicIcon, Transport],
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
          <hd-transport
            class="hd-round-btns"
            [labels]="skipLabels"
            [playing]="session.state === 'playing'"
            [previous]="size() !== 'small'"
            [next]="size() !== 'small'"
            (toggled)="control(session, session.state === 'playing' ? 'pause' : 'play')"
            (skippedBack)="control(session, 'skipPrevious')"
            (skippedForward)="control(session, 'skipNext')"
          />
        </div>
      </div>
      <div class="hd-progress hd-plex__progress" role="progressbar" [attr.aria-valuenow]="percent(session)" aria-valuemin="0" aria-valuemax="100">
        <div class="hd-progress__bar hd-plex__progress-fill" [style.width.%]="percent(session)"></div>
      </div>
    } @else {
      <svg class="hd-icon" [lucideIcon]="tvIcon" />
      <div>
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
    <hd-tile-details [screen]="true" [name]="face().name" [icon]="tvIcon" [subtitle]="detailsSubtitle()">
      <div class="hd-plex-now__pane" [attr.data-count]="sessions().length">
        @for (item of sessions(); track item.id) {
          <article class="hd-plex-now__session">
            @if (item.image && !images.has(item.image)) {
              <img class="hd-plex-now__poster" [src]="posterUrl(item, item.image)" alt="" draggable="false" (error)="images.mark(item.image)" />
            } @else {
              <div class="hd-plex-now__poster hd-plex-now__poster--none"><svg [lucideIcon]="tvIcon" /></div>
            }
            <div class="hd-plex-now__info">
              <h3 class="hd-plex-now__title">{{ item.title }}</h3>
              @if (item.subtitle) {
                <div class="hd-plex-now__sub">{{ item.subtitle }}</div>
              }
              <div class="hd-plex-now__who">{{ who(item) }}</div>
              <div class="hd-progress hd-plex__progress hd-plex__progress--inline" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="percent(item)">
                <div class="hd-progress__bar hd-plex__progress-fill" [style.width.%]="percent(item)"></div>
              </div>
              <span class="hd-plex__time">{{ time(item) }}</span>
              <hd-transport
                class="hd-plex-now__controls"
                playClass="hd-plex-now__play"
                [labels]="playerLabels(item)"
                [playing]="item.state === 'playing'"
                (toggled)="control(item, item.state === 'playing' ? 'pause' : 'play')"
                (skippedBack)="control(item, 'skipPrevious')"
                (skippedForward)="control(item, 'skipNext')"
              />
            </div>
          </article>
        } @empty {
          <p class="hd-details__label">Nothing playing</p>
        }
        @if (flash() === 'error') {
          <p class="hd-plex-details__error" role="alert">The player didn't take it. Turn on Advertise as player in its Plex settings.</p>
        }
      </div>
    </hd-tile-details>
  `,
})
export class NowPlayingTile extends PlexTileView {
  protected readonly tvIcon = LucideTv;
  protected readonly skipLabels = { previous: 'Skip back', next: 'Skip forward', play: 'Play', pause: 'Pause' };

  protected playerLabels(item: LivePlexSession) {
    const on = item.playerName;
    return { previous: `Skip back on ${on}`, next: `Skip forward on ${on}`, play: `Play ${on}`, pause: `Pause ${on}` };
  }

  /** The sessions this tile follows on its account: one player's, or every one. */
  protected readonly sessions = computed(() => {
    const target = this.settings().target;
    const accountId = this.overview()?.accountId;
    const sessions = this.plex.sessions().filter((s) => s.accountId === accountId);
    if (!target || target === ANY_PLEX_PLAYER) return sessions;
    return sessions.filter((s) => `plex-player:${s.playerId}` === target);
  });

  private readonly index = signal(0);

  /** Posters that did not load, so an icon shows instead of a broken picture. */
  protected readonly images = brokenImages();
  protected readonly session = computed<LivePlexSession | undefined>(() => {
    const sessions = this.sessions();
    return sessions.length ? sessions[this.index() % sessions.length] : undefined;
  });

  /** Ticks every second while something plays, so progress moves. */
  private readonly now = clock(1000, () => this.sessions().some((s) => s.state === 'playing'));

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
    const cycler = setInterval(() => {
      if (this.sessions().length > 1) this.index.update((i) => i + 1);
    }, NOW_PLAYING_CYCLE_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(cycler));
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
    const wide = isLandscape(this.size());
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
