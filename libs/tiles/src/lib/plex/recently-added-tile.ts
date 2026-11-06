import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { AirPlayDevice, AirPlayPlayback, ALL_PLEX_LIBRARIES, PlexItem, PlexTracks, Realtime, plexImageUrl } from '@homey-dash/api-client';
import { TileSize } from '@homey-dash/layout';
import {
  LucideAirplay,
  LucideChevronLeft,
  LucideClapperboard,
  LucideDynamicIcon,
  LucidePause,
  LucidePlay,
  LucideSquare,
  LucideStar,
} from '@lucide/angular';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';
import { AirPlayData } from './airplay-data';
import { PlexData } from './plex-data';
import { plexIdle } from './now-playing-tile';

/** How many posters fit a tile: one per cell across, two rows on the large sizes. */
export const RECENT_POSTERS: Record<TileSize, number> = { small: 1, wide: 2, full: 3, large: 4, 'full-large': 6, 'full-tall': 12 };

/** How many items the detail view lists. */
const DETAIL_COUNT = 24;

/** Where choosing a receiver for a cover is: the button, looking for receivers, choosing one, starting. Once it plays, every screen shows it from `AirPlayData`. */
interface Cast {
  step: 'idle' | 'searching' | 'choosing' | 'starting';
  /** The cover it is for. */
  itemId?: string;
  devices: AirPlayDevice[];
  device?: AirPlayDevice;
  error?: string;
}

const IDLE: Cast = { step: 'idle', devices: [] };

/** What the backend says went wrong (a hub error carries its message after the method), else a fallback. */
function reason(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.replace(/^.*HubException:\s*/, '') : '';
  return message && !message.startsWith('An unexpected error') ? message : fallback;
}

/** How long it runs, as people say it: 2h 46m, 33m. */
export function runtime(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;
}

/** When something was added, as people say it: Today, Yesterday, 3 days ago, 12 Aug. */
export function addedOn(iso: string, now = Date.now()): string {
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * The posters of what was newly added to one library of the tile's Plex account, or every library of it
 * (`plex-library:all`), newest first: as
 * many as fit the tile, with their titles. A press opens a full-screen detail view in Plex colours: a grid of the newest 24 posters with when each was added,
 * and tabs per library when the tile covers several. A press on a poster opens its details: backdrop, summary, year,
 * runtime, rating and genres.
 */
@Component({
  selector: 'hd-plex-recent-tile',
  imports: [TileDetails, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-plex-recent', '[class.has-art]': 'shown().length > 0' },
  template: `
    @if (shown().length) {
      <div class="hd-plex-recent__grid" [attr.data-count]="shown().length">
        @for (item of shown(); track item.id) {
          <div class="hd-plex-recent__item">
            @if (item.image) {
              <img class="hd-plex-recent__poster" [src]="posterUrl(item.image)" alt="" draggable="false" />
            }
            <div class="hd-plex-recent__caption">
              <div class="hd-plex-recent__title">{{ item.title }}</div>
              @if (item.subtitle) {
                <div class="hd-plex-recent__sub">{{ item.subtitle }}</div>
              }
            </div>
          </div>
        }
      </div>
      @if (settings().label) {
        <div class="hd-photo__label">{{ settings().label }}</div>
      }
    } @else {
      <svg class="hd-icon" [lucideIcon]="icon" />
      <div>
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
    @if (casting().length) {
      <div
        class="hd-plex-recent__casting"
        [class.is-paused]="allPaused()"
        role="img"
        [attr.aria-label]="(allPaused() ? 'Paused on ' : 'Playing on ') + casting()[0].deviceName"
      >
        <svg [lucideIcon]="allPaused() ? pauseIcon : playIcon" />
      </div>
    }
    <hd-tile-details [screen]="true" [name]="face().name" [icon]="icon" subtitle="Newly added" (closed)="closeScreen()">
      @if (!selected() && tabs().length > 2) {
        <div class="hd-segmented" hdDetailsHead role="group" aria-label="Show">
          @for (t of tabs(); track t.id) {
            <button type="button" [attr.aria-pressed]="tab() === t.id" (click)="selectTab(t.id)">{{ t.label }}</button>
          }
        </div>
      }
      @for (p of casting(); track p.deviceId) {
        <div class="hd-plex-recent__now" role="group" [attr.aria-label]="'Playing on ' + p.deviceName">
          <div class="hd-plex-recent__now-text">
            <strong>{{ p.title }}</strong>
            <span>{{ busy().includes(p.deviceId) ? 'Starting on' : p.paused ? 'Paused on' : 'Playing on' }} {{ p.deviceName }}</span>
          </div>
          <button type="button" class="hd-plex-recent__receiver" [disabled]="busy().includes(p.deviceId)" (click)="togglePause(p)">
            <svg [lucideIcon]="p.paused ? playIcon : pauseIcon" />{{ p.paused ? 'Resume' : 'Pause' }}
          </button>
          <button type="button" class="hd-plex-recent__receiver" (click)="stop(p)"><svg [lucideIcon]="stopIcon" />Stop</button>
          @if (tracksFor(p); as t) {
            @if (t.audio.length > 1) {
              <label class="hd-plex-recent__track">
                <span>Audio</span>
                <select [disabled]="busy().includes(p.deviceId)" (change)="pickAudio(p, $any($event.target).value)">
                  @for (a of t.audio; track a.id) {
                    <option [value]="a.id" [selected]="a.id === audioOf(p, t)">{{ a.label }}</option>
                  }
                </select>
              </label>
            }
            @if (t.subtitles.length) {
              <label class="hd-plex-recent__track">
                <span>Subtitles</span>
                <select [disabled]="busy().includes(p.deviceId)" (change)="pickSubtitle(p, $any($event.target).value)">
                  <option value="" [selected]="!p.subtitleStreamId">Off</option>
                  @for (sub of t.subtitles; track sub.id) {
                    <option [value]="sub.id" [selected]="sub.id === p.subtitleStreamId">{{ sub.label }}</option>
                  }
                </select>
              </label>
            }
          }
          @if (errors()[p.deviceId]; as error) {
            <div class="hd-plex-recent__cast-error" role="alert">{{ error }}</div>
          }
        </div>
      }
      @if (selected(); as item) {
        <div class="hd-plex-recent__detail">
          @if (item.art) {
            <img class="hd-plex-recent__backdrop" [src]="artUrl(item.art)" alt="" draggable="false" />
          }
          <button type="button" class="hd-round-btn hd-plex-recent__back" aria-label="Back to the covers" (click)="selected.set(null)">
            <svg [lucideIcon]="backIcon" />
          </button>
          <div class="hd-plex-recent__cover hd-plex-recent__cover--large">
            @if (item.image) {
              <img [src]="posterUrl(item.image)" alt="" draggable="false" />
            } @else {
              <svg [lucideIcon]="icon" />
            }
          </div>
          <div class="hd-plex-recent__facts">
            <div class="hd-plex-recent__added">{{ added(item) }}</div>
            <h3 class="hd-plex-recent__headline">{{ item.title }}</h3>
            @if (tagline(item); as tagline) {
              <div class="hd-plex-recent__tagline">{{ tagline }}</div>
            }
            @if (meta(item).length || item.rating) {
              <div class="hd-plex-recent__meta">
                @if (item.rating) {
                  <span class="hd-plex-recent__rating"><svg [lucideIcon]="starIcon" />{{ item.rating }}</span>
                }
                @for (m of meta(item); track m) {
                  <span>{{ m }}</span>
                }
                @if (item.contentRating) {
                  <span class="hd-plex-recent__certificate">{{ item.contentRating }}</span>
                }
              </div>
            }
            @if (item.genres?.length) {
              <div class="hd-plex-recent__genres">
                @for (g of item.genres; track g) {
                  <span>{{ g }}</span>
                }
              </div>
            }
            @if (item.summary) {
              <p class="hd-plex-recent__summary">{{ item.summary }}</p>
            }
            @if (playable(item)) {
              <div class="hd-plex-recent__cast">
                @let c = castFor(item);
                @switch (c.step) {
                  @case ('idle') {
                    <button type="button" class="hd-plex-recent__play" (click)="findReceivers(item)">
                      <svg [lucideIcon]="airPlayIcon" />Play on AirPlay
                    </button>
                  }
                  @case ('searching') {
                    <div class="hd-plex-recent__cast-note">Looking for Apple TVs…</div>
                  }
                  @case ('choosing') {
                    <div class="hd-plex-recent__cast-note">Play on</div>
                    <div class="hd-plex-recent__receivers">
                      @for (d of c.devices; track d.id) {
                        <button type="button" class="hd-plex-recent__receiver" (click)="playOn(item, d)">{{ d.name }}</button>
                      } @empty {
                        <div class="hd-plex-recent__cast-note">No paired Apple TV. Pair one in Management under Accounts.</div>
                      }
                    </div>
                  }
                }
                @if (c.error) {
                  <div class="hd-plex-recent__cast-error" role="alert">{{ c.error }}</div>
                }
              </div>
            }
          </div>
        </div>
      } @else {
        <input
          type="search"
          class="hd-plex-recent__search"
          placeholder="Search"
          aria-label="Search"
          autocomplete="off"
          [value]="query()"
          (input)="onSearch($any($event.target).value)"
        />
        <div class="hd-plex-recent__pane">
          @for (item of listed(); track item.id) {
            <button type="button" class="hd-plex-recent__card" (click)="selected.set(item)">
              <div class="hd-plex-recent__cover">
                @if (item.image) {
                  <img [src]="posterUrl(item.image)" alt="" loading="lazy" draggable="false" />
                } @else {
                  <svg [lucideIcon]="icon" />
                }
                @if (isNew(item)) {
                  <span class="hd-plex-recent__badge">New</span>
                }
              </div>
              <div class="hd-plex-recent__card-title">{{ item.title }}</div>
              @if (item.subtitle) {
                <div class="hd-plex-recent__card-sub">{{ item.subtitle }}</div>
              }
              @if (added(item); as when) {
                <div class="hd-plex-recent__card-added">{{ when }}</div>
              }
            </button>
          } @empty {
            <div class="hd-plex-recent__empty">
              {{ searching() ? 'Searching…' : searchError() || (results() ? 'Nothing found for “' + query().trim() + '”' : 'Nothing added yet') }}
            </div>
          }
        </div>
      }
    </hd-tile-details>
  `,
})
export class RecentlyAddedTile extends TileView {
  private readonly plex = inject(PlexData);
  private readonly realtime = inject(Realtime);
  private readonly airPlay = inject(AirPlayData);

  protected readonly icon = LucideClapperboard;
  protected readonly backIcon = LucideChevronLeft;
  protected readonly starIcon = LucideStar;
  protected readonly airPlayIcon = LucideAirplay;
  protected readonly stopIcon = LucideSquare;
  protected readonly playIcon = LucidePlay;
  protected readonly pauseIcon = LucidePause;

  private readonly overview = computed(() => this.plex.overview(this.settings().account));

  private readonly library = computed(() => {
    const target = this.settings().target;
    return this.overview()?.libraries.find((l) => `plex-library:${l.id}` === target);
  });

  /** The target's newest items, merged across libraries for `plex-library:all`. */
  protected readonly items = computed<PlexItem[]>(() => {
    const target = this.settings().target;
    const libraries = this.overview()?.libraries ?? [];
    if (target === ALL_PLEX_LIBRARIES)
      return libraries.flatMap((l) => l.recent).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return this.library()?.recent ?? [];
  });

  /** The detail view's tabs: everything, then each library the target holds. Shown when there is more than one library. */
  protected readonly tabs = computed(() => {
    const libraries = this.overview()?.libraries ?? [];
    if (this.settings().target !== ALL_PLEX_LIBRARIES) return [];
    const withItems = libraries.filter((l) => l.recent.length);
    return [{ id: 'all', label: 'All' }, ...withItems.map((l) => ({ id: l.id, label: l.title }))];
  });
  protected readonly tab = signal('all');
  /** The cover opened for its details. */
  protected readonly selected = signal<PlexItem | null>(null);
  private readonly cast = signal<Cast>(IDLE);

  /** What plays on AirPlay now for this account, wherever it was started: its controls stay on show. */
  protected readonly casting = computed(() => this.airPlay.playing().filter((p) => p.accountId === (this.overview()?.accountId ?? 0)));
  protected readonly allPaused = computed(() => this.casting().every((p) => p.paused));
  /** Receivers whose stream is being started over with another track. */
  protected readonly busy = signal<string[]>([]);
  protected readonly errors = signal<Record<string, string>>({});
  private readonly tracks = signal<Record<string, PlexTracks>>({});
  private readonly tracksLoading = new Set<string>();

  protected readonly query = signal('');
  /** What the search found; null when nothing is being searched for. */
  protected readonly results = signal<PlexItem[] | null>(null);
  protected readonly searching = signal(false);
  protected readonly searchError = signal('');
  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    // Each thing that plays gets its tracks, to choose between.
    effect(() => this.casting().forEach((p) => void this.loadTracks(p)));
  }

  /** What the detail view lists: the newest of the chosen tab. */
  protected readonly detailItems = computed<PlexItem[]>(() => {
    const tab = this.tab();
    const libraries = this.overview()?.libraries ?? [];
    const source =
      tab === 'all' || !this.tabs().some((t) => t.id === tab)
        ? this.items()
        : (libraries.find((l) => l.id === tab)?.recent ?? []);
    return source.slice(0, DETAIL_COUNT);
  });

  /** What the grid lists: what the search found, else the newest of the chosen tab. */
  protected readonly listed = computed<PlexItem[]>(() => this.results() ?? this.detailItems());

  protected readonly shown = computed(() => (this.face().state === 'ok' ? this.items().slice(0, RECENT_POSTERS[this.size()]) : []));

  readonly face = computed<TileFace>(() => {
    const look = { icon: LucideClapperboard, hue: 'neutral' as const };
    const { target, label } = this.settings();
    const overview = this.overview();
    const status = this.plex.status(this.settings().account);
    const name = label || (target === ALL_PLEX_LIBRARIES ? 'Recently added' : (this.library()?.title ?? 'Plex library'));
    if (!target) return { ...look, name, detail: 'Pick a library', state: 'unset' };
    if (!overview?.loaded) {
      return status && status !== 'connected'
        ? { ...look, name, detail: plexIdle(status, overview?.error), state: 'unavailable' }
        : { ...look, name, detail: '…', state: 'loading' };
    }
    if (target !== ALL_PLEX_LIBRARIES && !this.library()) return { ...look, name, detail: 'Library not found in Plex', state: 'missing' };
    if (!this.items().length) return { ...look, name, detail: 'Nothing added yet', state: 'ok' };
    return { ...look, name, detail: '', details: true, state: 'ok' };
  });

  protected posterUrl(path: string) {
    return plexImageUrl(this.overview()?.accountId ?? 0, path, 400, 600);
  }

  /** When it was added; nothing when the server didn't say (a search result without a date). */
  protected added(item: PlexItem) {
    return new Date(item.addedAt).getTime() > 0 ? addedOn(item.addedAt) : '';
  }

  protected artUrl(path: string) {
    return plexImageUrl(this.overview()?.accountId ?? 0, path, 1280, 720);
  }

  /** The subtitle, unless it only repeats the year the facts already show. */
  protected tagline(item: PlexItem) {
    return item.subtitle && item.subtitle !== `${item.year}` ? item.subtitle : null;
  }

  /** Year and how long it runs, when the server says. */
  protected meta(item: PlexItem) {
    return [item.year ? `${item.year}` : null, item.durationMs ? runtime(item.durationMs) : null].filter((m): m is string => !!m);
  }

  /** Only a movie or an episode plays on a TV. */
  protected playable(item: PlexItem) {
    return item.kind === 'movie' || item.kind === 'episode';
  }

  /** Where playing this cover is; the others start from the button. */
  protected castFor(item: PlexItem): Cast {
    const cast = this.cast();
    return cast.itemId === item.id ? cast : IDLE;
  }

  protected async findReceivers(item: PlexItem) {
    this.cast.set({ step: 'searching', itemId: item.id, devices: [] });
    try {
      const info = await this.realtime.airPlayDevices();
      if (!info.available) return this.cast.set({ ...IDLE, itemId: item.id, error: 'AirPlay is not set up in HomeyDash yet.' });
      this.cast.set({ step: 'choosing', itemId: item.id, devices: info.devices.filter((d) => d.kind === 'tv') });
    } catch (error) {
      this.cast.set({ ...IDLE, itemId: item.id, error: reason(error, 'Could not look for Apple TVs.') });
    }
  }

  protected async playOn(item: PlexItem, device: AirPlayDevice) {
    this.cast.set({ step: 'starting', itemId: item.id, devices: [], device });
    try {
      await this.realtime.playOnAirPlay(this.overview()?.accountId ?? 0, item.id, device.id);
      // From here the playing shows from AirPlayData, on this screen and every other.
      this.cast.set(IDLE);
    } catch (error) {
      this.cast.set({ ...IDLE, itemId: item.id, error: reason(error, `Could not play on ${device.name}.`) });
    }
  }

  protected async togglePause(playing: AirPlayPlayback) {
    await this.attempt(playing, () => this.realtime.setAirPlayPaused(playing.deviceId, !playing.paused),
      `Could not ${playing.paused ? 'resume' : 'pause'} ${playing.deviceName}.`);
  }

  protected async stop(playing: AirPlayPlayback) {
    await this.attempt(playing, () => this.realtime.stopAirPlay(playing.deviceId), `Could not stop ${playing.deviceName}.`);
  }

  protected tracksFor(playing: AirPlayPlayback): PlexTracks | undefined {
    return this.tracks()[`${playing.accountId}:${playing.itemId}`];
  }

  /** The audio track in use: the choice made, else the one Plex plays by default. */
  protected audioOf(playing: AirPlayPlayback, tracks: PlexTracks) {
    return playing.audioStreamId ?? tracks.audio.find((t) => t.selected)?.id ?? tracks.audio[0]?.id;
  }

  protected async pickAudio(playing: AirPlayPlayback, audioStreamId: string) {
    await this.changeTracks(playing, audioStreamId, playing.subtitleStreamId);
  }

  protected async pickSubtitle(playing: AirPlayPlayback, subtitleStreamId: string) {
    const tracks = this.tracksFor(playing);
    await this.changeTracks(playing, tracks ? this.audioOf(playing, tracks) ?? null : playing.audioStreamId, subtitleStreamId || null);
  }

  private async changeTracks(playing: AirPlayPlayback, audio: string | null, subtitle: string | null) {
    this.busy.update((b) => [...b, playing.deviceId]);
    try {
      await this.attempt(playing, () => this.realtime.changeAirPlayTracks(playing.deviceId, audio, subtitle), `Could not change the tracks on ${playing.deviceName}.`);
    } finally {
      this.busy.update((b) => b.filter((id) => id !== playing.deviceId));
    }
  }

  private async attempt(playing: AirPlayPlayback, action: () => Promise<void>, fallback: string) {
    try {
      await action();
      this.errors.update(({ [playing.deviceId]: _, ...others }) => others);
    } catch (error) {
      this.errors.update((errors) => ({ ...errors, [playing.deviceId]: reason(error, fallback) }));
    }
  }

  private async loadTracks(playing: AirPlayPlayback) {
    const key = `${playing.accountId}:${playing.itemId}`;
    if (this.tracks()[key] || this.tracksLoading.has(key)) return;
    this.tracksLoading.add(key);
    try {
      const tracks = await this.realtime.plexTracks(playing.accountId, playing.itemId);
      this.tracks.update((all) => ({ ...all, [key]: tracks }));
    } catch {
      // Without its tracks there is nothing to choose; pausing and stopping still work.
    } finally {
      this.tracksLoading.delete(key);
    }
  }

  protected selectTab(id: string) {
    this.tab.set(id);
    if (this.query().trim().length >= 2) this.onSearch(this.query());
  }

  protected onSearch(value: string) {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    this.searchError.set('');
    if (value.trim().length < 2) {
      this.results.set(null);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.searchTimer = setTimeout(() => void this.runSearch(value.trim()), 300);
  }

  private async runSearch(query: string) {
    // One library when the tile covers one or a tab picked one; else all of them.
    const target = this.settings().target;
    const tab = this.tab();
    const library =
      target === ALL_PLEX_LIBRARIES ? (tab !== 'all' && this.tabs().some((t) => t.id === tab) ? tab : null) : (this.library()?.id ?? null);
    try {
      const found = await this.realtime.searchPlex(this.overview()?.accountId ?? 0, query, library);
      if (this.query().trim() === query) this.results.set(found);
    } catch (error) {
      if (this.query().trim() !== query) return;
      this.results.set([]);
      this.searchError.set(reason(error, 'Could not search Plex.'));
    } finally {
      if (this.query().trim() === query) this.searching.set(false);
    }
  }

  protected closeScreen() {
    this.selected.set(null);
    this.onSearch('');
  }


  /** Added today or yesterday. */
  protected isNew(item: PlexItem) {
    const label = addedOn(item.addedAt);
    return label === 'Today' || label === 'Yesterday';
  }
}
