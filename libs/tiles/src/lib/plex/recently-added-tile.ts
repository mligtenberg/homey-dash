import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, signal, untracked, viewChild } from '@angular/core';
import { AirPlayDevice, AirPlayPlayback, ALL_PLEX_LIBRARIES, PlexItem, PlexLibrary, PlexProfile, PlexProfileList, PlexTracks, Realtime, plexAudioUrl, plexImageUrl, plexVideoUrl } from '@homey-dash/api-client';
import { TileSize } from '@homey-dash/layout';
import {
  LucideAirplay,
  LucideCheck,
  LucideChevronLeft,
  LucideClapperboard,
  LucideDynamicIcon,
  LucideLibrary,
  LucideLock,
  LucidePause,
  LucidePlay,
  LucideSquare,
  LucideTv,
  LucideStar,
  LucideUser,
  LucideVolume2,
} from '@lucide/angular';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace, TileView } from '../core/tile-view';
import { AirPlayData } from './airplay-data';
import { PlexData, plexTime } from './plex-data';
import { plexIdle } from './now-playing-tile';

/** How many posters fit a tile: one per cell across, two rows on the large sizes. */
export const RECENT_POSTERS: Record<TileSize, number> = { small: 1, wide: 2, full: 3, large: 4, 'full-large': 6, 'full-tall': 12 };

/** How many items the detail view lists. */
const DETAIL_COUNT = 24;

/** The next number for a tile's profile popover. */
let nextProfilesId = 0;

/** How often Plex is told where a playing video is (ms). */
const VIDEO_REPORT_EVERY = 10_000;

/** How many items of a library are asked for at a time, and how close to the end of the list that asks for the next ones (px). */
const PAGE = 60;
const NEAR_END = 600;

/** What a library listing has of one library so far: the pages that came, and how many there are in all. */
interface Pages {
  items: PlexItem[];
  total: number;
  loading: boolean;
  error?: string;
}

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

/** Music playing on this screen: the tracks to play and which one plays now, and the album they are part of. */
interface LocalPlay {
  queue: PlexItem[];
  index: number;
  paused: boolean;
  album: PlexItem | null;
}

/** What is under a show, season or album: nothing while it loads. */
interface Under {
  items?: PlexItem[];
  error?: string;
}

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

/** The full-screen view of Plex tiles that browse a library: the newest or everything, shown the same way (see `LibraryTile`). */
export const PLEX_BROWSER_TEMPLATE = `    @if (shown().length) {
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
      @if (faceLabel(); as label) {
        <div class="hd-photo__label">{{ label }}</div>
      }
    } @else {
      <svg class="hd-icon" [lucideIcon]="icon" />
      <div>
        <div class="hd-tile__name">{{ face().name }}</div>
        <div class="hd-tile__detail">{{ face().detail }}</div>
      </div>
    }
    @if (badge(); as b) {
      <div class="hd-plex-recent__casting" [class.is-paused]="b.paused" role="img" [attr.aria-label]="b.label">
        <svg [lucideIcon]="b.paused ? pauseIcon : playIcon" />
      </div>
    }
    <hd-tile-details [screen]="true" [name]="face().name" [icon]="icon" [subtitle]="subtitle()" (closed)="closeScreen()">
      @if (video(); as v) {
        <div class="hd-plex-recent__player" role="dialog" [attr.aria-label]="v.title">
          <video
            class="hd-plex-recent__video"
            [src]="videoUrl(v)"
            autoplay
            controls
            playsinline
            (play)="onVideo(v, 'playing', $any($event.target).currentTime)"
            (pause)="onVideo(v, 'paused', $any($event.target).currentTime)"
            (timeupdate)="onVideoTime(v, $any($event.target).currentTime)"
            (ended)="stopVideo(true)"
            (error)="videoFailed(v)"
          ></video>
          <div class="hd-plex-recent__player-bar">
            <strong>{{ v.title }}</strong>
            <button type="button" class="hd-plex-recent__receiver" (click)="stopVideo()"><svg [lucideIcon]="stopIcon" />Stop</button>
          </div>
        </div>
      }
      @if (!selected() && tabs().length > (browse ? 1 : 2)) {
        <div class="hd-segmented" hdDetailsHead role="group" aria-label="Show">
          @for (t of tabs(); track t.id) {
            <button type="button" [attr.aria-pressed]="activeTab() === t.id" (click)="selectTab(t.id)">{{ t.label }}</button>
          }
        </div>
      }
      @if (local(); as l) {
        <div class="hd-plex-recent__now" role="group" aria-label="Playing here">
          <div class="hd-plex-recent__now-text">
            <strong>{{ l.queue[l.index].title }}</strong>
            @if (localDetail(l); as detail) {
              <span>{{ detail }}</span>
            }
            <span>{{ l.paused ? 'Paused here' : 'Playing here' }}</span>
          </div>
          <button type="button" class="hd-plex-recent__receiver" (click)="toggleLocal()">
            <svg [lucideIcon]="l.paused ? playIcon : pauseIcon" />{{ l.paused ? 'Resume' : 'Pause' }}
          </button>
          <button type="button" class="hd-plex-recent__receiver" (click)="stopLocal()"><svg [lucideIcon]="stopIcon" />Stop</button>
        </div>
      }
      @for (p of casting(); track p.deviceId) {
        <div class="hd-plex-recent__now" role="group" [attr.aria-label]="'Playing on ' + p.deviceName">
          <div class="hd-plex-recent__now-text">
            <strong>{{ p.title }}</strong>
            @if (p.detail) {
              <span>{{ p.detail }}</span>
            }
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
          <button type="button" class="hd-round-btn hd-plex-recent__back" [attr.aria-label]="trail().length > 1 ? 'Back' : 'Back to the covers'" (click)="back()">
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
            <div class="hd-plex-recent__added">{{ crumbs() || added(item) }}</div>
            <h3 class="hd-plex-recent__headline">{{ item.title }}</h3>
            @if (tagline(item); as tagline) {
              <div class="hd-plex-recent__tagline">{{ tagline }}</div>
            }
            @if (meta(item).length || item.rating || item.watched) {
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
                @if (item.watched) {
                  <span class="hd-plex-recent__watched"><svg [lucideIcon]="seenIcon" />Watched</span>
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
                      <svg [lucideIcon]="airPlayIcon" />{{ item.kind === 'album' ? 'Play album on AirPlay' : 'Play on AirPlay' }}
                    </button>
                    <button type="button" class="hd-plex-recent__receiver" (click)="playHere(item)">
                      <svg [lucideIcon]="item.kind === 'movie' || item.kind === 'episode' ? tvIcon : speakerIcon" />{{ item.kind === 'album' ? 'Play album here' : 'Play here' }}
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
                @if (localError(); as error) {
                  <div class="hd-plex-recent__cast-error" role="alert">{{ error }}</div>
                }
              </div>
            }
          </div>
          @if (hasChildren(item)) {
            @let under = childrenOf(item);
            <div class="hd-plex-recent__children">
              <h4 class="hd-plex-recent__section">{{ childrenTitle(item) }}</h4>
              @if (under.error) {
                <div class="hd-plex-recent__empty" role="alert">{{ under.error }}</div>
              } @else if (!under.items) {
                <div class="hd-plex-recent__empty">Loading…</div>
              } @else if (!under.items.length) {
                <div class="hd-plex-recent__empty">Nothing here</div>
              } @else if (item.kind === 'show') {
                <div class="hd-plex-recent__seasons">
                  @for (child of under.items; track child.id) {
                    <button type="button" class="hd-plex-recent__card" (click)="push(child)">
                      <div class="hd-plex-recent__cover">
                        @if (child.image) {
                          <img [src]="posterUrl(child.image)" alt="" loading="lazy" draggable="false" />
                        } @else {
                          <svg [lucideIcon]="icon" />
                        }
                        @if (child.watched) {
                          <span class="hd-plex-recent__seen" role="img" aria-label="Watched"><svg [lucideIcon]="seenIcon" /></span>
                        }
                      </div>
                      <div class="hd-plex-recent__card-title">{{ child.title }}</div>
                      @if (child.subtitle) {
                        <div class="hd-plex-recent__card-sub">{{ child.subtitle }}</div>
                      }
                    </button>
                  }
                </div>
              } @else {
                <ol class="hd-plex-recent__rows">
                  @for (child of under.items; track child.id) {
                    <li>
                      <button type="button" class="hd-plex-recent__row" (click)="push(child)">
                        <span class="hd-plex-recent__row-no">{{ child.index }}</span>
                        <span class="hd-plex-recent__row-title">
                          {{ child.title }}
                          @if (child.subtitle) {
                            <small>{{ child.subtitle }}</small>
                          }
                        </span>
                        <span class="hd-plex-recent__row-time">
                          @if (child.watched) {
                            <svg role="img" aria-label="Watched" [lucideIcon]="seenIcon" />
                          }
                          {{ length(child) }}
                        </span>
                      </button>
                    </li>
                  }
                </ol>
              }
            </div>
          }
        </div>
      } @else {
        <div class="hd-plex-recent__bar">
          <input
            type="search"
            class="hd-plex-recent__search"
            placeholder="Search"
            aria-label="Search"
            autocomplete="off"
            [value]="query()"
            (input)="onSearch($any($event.target).value)"
          />
          @if (profileName(); as name) {
            <button
              type="button"
              class="hd-plex-recent__receiver hd-plex-recent__profile"
              [attr.popovertarget]="profilesId"
              [style.anchor-name]="'--' + profilesId"
              aria-haspopup="true"
            >
              <svg [lucideIcon]="profileIcon" />{{ name }}
            </button>
            <div
              #profilesPanel
              class="hd-plex-recent__profiles"
              popover
              role="group"
              aria-label="Profile"
              [id]="profilesId"
              [style.position-anchor]="'--' + profilesId"
              (toggle)="onProfilesToggle($any($event).newState)"
            >
              @for (p of profiles()?.profiles ?? []; track p.id) {
                <button
                  type="button"
                  class="hd-plex-recent__profile-option"
                  [attr.aria-pressed]="p.id === profiles()?.currentId"
                  [disabled]="switching()"
                  (click)="chooseProfile(p)"
                >
                  {{ p.name }}
                  @if (p.protected) {
                    <svg role="img" aria-label="PIN" [lucideIcon]="lockIcon" />
                  }
                </button>
              }
              @if (pinFor(); as p) {
                <form class="hd-plex-recent__pin" (submit)="$event.preventDefault(); switchProfile(p, pin.value)">
                  <input #pin type="password" inputmode="numeric" autocomplete="off" [placeholder]="'PIN for ' + p.name" [attr.aria-label]="'PIN for ' + p.name" />
                  <button type="submit" class="hd-plex-recent__play" [disabled]="switching()">Switch</button>
                </form>
              }
              @if (profileError(); as error) {
                <div class="hd-plex-recent__cast-error" role="alert">{{ error }}</div>
              }
            </div>
          }
        </div>
        <div #pane class="hd-plex-recent__pane" (scroll)="onPaneScroll($any($event.target))">
          @for (item of listed(); track item.id) {
            <button type="button" class="hd-plex-recent__card" (click)="open(item)">
              <div class="hd-plex-recent__cover">
                @if (item.image) {
                  <img [src]="posterUrl(item.image)" alt="" loading="lazy" draggable="false" />
                } @else {
                  <svg [lucideIcon]="icon" />
                }
                @if (item.watched) {
                  <span class="hd-plex-recent__seen" role="img" aria-label="Watched"><svg [lucideIcon]="seenIcon" /></span>
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
              {{ searching() ? 'Searching…' : searchError() || (results() ? 'Nothing found for “' + query().trim() + '”' : emptyText()) }}
            </div>
          }
        </div>
      }
    </hd-tile-details>
`;

/**
 * The posters of what was newly added to one library of the tile's Plex account, or every library of it
 * (`plex-library:all`), newest first: as
 * many as fit the tile, with their titles. A press opens a full-screen detail view in Plex colours: a grid of the newest 24 posters with when each was added,
 * and tabs per library when the tile covers several. A press on a poster opens its details: backdrop, summary, year,
 * runtime, rating and genres. A show lists its seasons, a season its episodes and an album its tracks, each one pressed
 * for its own details; a movie, episode, track or album plays on an Apple TV.
 */
@Component({
  selector: 'hd-plex-recent-tile',
  imports: [TileDetails, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-plex-recent', '[class.has-art]': 'shown().length > 0' },
  template: PLEX_BROWSER_TEMPLATE,
})
export class RecentlyAddedTile extends TileView {
  /** Whether this lists everything a library holds, a page at a time (the library tile), instead of the newest. */
  protected readonly browse: boolean = false;
  private readonly plex = inject(PlexData);
  private readonly realtime = inject(Realtime);
  private readonly airPlay = inject(AirPlayData);

  protected readonly icon: typeof LucideClapperboard | typeof LucideLibrary = LucideClapperboard;
  protected readonly backIcon = LucideChevronLeft;
  protected readonly starIcon = LucideStar;
  protected readonly airPlayIcon = LucideAirplay;
  protected readonly stopIcon = LucideSquare;
  protected readonly playIcon = LucidePlay;
  protected readonly pauseIcon = LucidePause;
  protected readonly speakerIcon = LucideVolume2;
  protected readonly tvIcon = LucideTv;
  protected readonly seenIcon = LucideCheck;
  protected readonly profileIcon = LucideUser;
  protected readonly lockIcon = LucideLock;

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
      return libraries.flatMap((l) => this.newestOf(l)).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    const library = this.library();
    return library ? this.newestOf(library) : [];
  });

  /** The detail view's tabs: everything, then each library the target holds. Shown when there is more than one library. */
  protected readonly tabs = computed(() => {
    const libraries = this.overview()?.libraries ?? [];
    if (this.settings().target !== ALL_PLEX_LIBRARIES) return [];
    const withItems = libraries.filter((l) => this.newestOf(l).length);
    const tabs = withItems.map((l) => ({ id: l.id, label: l.title }));
    // A library listing is of one library at a time; the newest of all of them are one list.
    return this.browse ? tabs : [{ id: 'all', label: 'All' }, ...tabs];
  });
  protected readonly tab = signal('all');

  /** What a library shows of itself on the face: what was newly added, or for a library listing its newest films, series or albums. */
  private newestOf(library: PlexLibrary): PlexItem[] {
    return this.browse ? (library.titles ?? []) : library.recent;
  }
  /** The tab on show: the one chosen, else the first (a library listing has no "all"). */
  protected readonly activeTab = computed(() => {
    const tab = this.tab();
    return this.tabs().some((t) => t.id === tab) ? tab : this.browse ? (this.tabs()[0]?.id ?? 'all') : 'all';
  });
  /** The covers opened for their details, the one on show last: a show, then its season, then an episode. */
  protected readonly trail = signal<PlexItem[]>([]);
  /** The cover on show. */
  protected readonly selected = computed(() => this.trail()[this.trail().length - 1] ?? null);
  /** What is under the shows, seasons and albums opened so far, by id: loading until it arrives. */
  private readonly under = signal<Record<string, Under>>({});
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

  /** Music playing on this screen, which goes on when the cover is closed. */
  protected readonly local = signal<LocalPlay | null>(null);
  protected readonly localError = signal('');
  private audio?: HTMLAudioElement;
  private theme?: HTMLAudioElement;
  private themeOf?: string;

  /** The film or episode playing in this screen's own picture, over the dialog. */
  protected readonly video = signal<PlexItem | null>(null);

  /** What the tile's face says plays: on an Apple TV, or here. */
  protected readonly badge = computed(() => {
    const local = this.local();
    if (this.casting().length) {
      const paused = this.allPaused();
      return { paused, label: (paused ? 'Paused on ' : 'Playing on ') + this.casting()[0].deviceName };
    }
    return local ? { paused: local.paused, label: local.paused ? 'Paused here' : 'Playing here' } : null;
  });

  /** What each library listing has so far, by library id. */
  private readonly pages = signal<Record<string, Pages>>({});

  /** The library a listing shows: the tab's, or the tile's own. */
  protected readonly shownLibrary = computed(() =>
    this.settings().target === ALL_PLEX_LIBRARIES ? this.activeTab() : (this.library()?.id ?? ''));

  private pageOf(id: string): Pages | undefined {
    return this.pages()[id];
  }

  /** How many films, series or albums the tile's libraries hold. */
  private readonly totalCount = computed(() => {
    const libraries = this.overview()?.libraries ?? [];
    return this.settings().target === ALL_PLEX_LIBRARIES
      ? libraries.reduce((sum, l) => sum + (l.count ?? 0), 0)
      : (this.library()?.count ?? 0);
  });

  /** The head's second line. */
  protected readonly subtitle = computed(() => {
    if (!this.browse) return 'Newly added';
    const library = this.overview()?.libraries.find((l) => l.id === this.shownLibrary());
    const noun = library?.type === 'show' ? 'shows' : library?.type === 'artist' ? 'albums' : 'movies';
    return library?.count ? `${library.count.toLocaleString()} ${noun}` : 'Library';
  });

  /** What the tile's face says over its posters: its own label; a library listing always names its library and how big it is. */
  protected readonly faceLabel = computed(() => {
    const { label } = this.settings();
    if (!this.browse) return label ?? '';
    const count = this.totalCount();
    return count ? `${this.face().name} · ${count.toLocaleString()}` : this.face().name;
  });

  protected emptyText() {
    if (!this.browse) return 'Nothing added yet';
    const page = this.pageOf(this.shownLibrary());
    return page?.error ?? (!page || page.loading ? 'Loading…' : 'Nothing in this library');
  }

  private async loadPage(id: string) {
    const current = this.pageOf(id);
    if (!id || current?.loading || (current && !current.error && current.items.length >= current.total)) return;
    const have = current?.items ?? [];
    this.pages.update((all) => ({ ...all, [id]: { items: have, total: current?.total ?? 0, loading: true } }));
    try {
      const page = await this.realtime.plexLibraryItems(this.overview()?.accountId ?? 0, id, have.length, PAGE);
      this.pages.update((all) => ({ ...all, [id]: { items: [...have, ...page.items], total: page.total, loading: false } }));
    } catch (error) {
      this.pages.update((all) => ({ ...all, [id]: { items: have, total: current?.total ?? 0, loading: false, error: reason(error, 'Could not load the library.') } }));
    }
  }

  /** The next page comes when the list is scrolled near its end. */
  protected onPaneScroll(pane: HTMLElement) {
    this.paneScroll = pane.scrollTop;
    if (this.browse && !this.results() && pane.scrollTop + pane.clientHeight >= pane.scrollHeight - NEAR_END) void this.loadPage(this.shownLibrary());
  }

  constructor() {
    super();
    // A library listing's first page comes when it is opened, and again for each library tab.
    effect(() => {
      const id = this.shownLibrary();
      if (this.browse && this.details()?.isOpen()) untracked(() => (this.pageOf(id) ? undefined : void this.loadPage(id)));
    });
    // The profiles are asked for each time the dialog opens, so a change made elsewhere shows.
    effect(() => {
      if (this.details()?.isOpen()) untracked(() => void this.loadProfiles());
    });
    // A show's theme plays from opening the show and goes on through its seasons and episodes; it stops when the show is left.
    effect(() => {
      const root = this.trail()[0];
      untracked(() => this.playTheme(root?.kind === 'show' ? root : null));
    });
    inject(DestroyRef).onDestroy(() => {
      this.stopTheme();
      this.stopLocal();
      this.stopVideo();
    });
    // Each thing that plays gets its tracks, to choose between.
    effect(() => this.casting().forEach((p) => void this.loadTracks(p)));
  }

  /** What the detail view lists: the newest of the chosen tab. */
  protected readonly detailItems = computed<PlexItem[]>(() => {
    const tab = this.activeTab();
    const libraries = this.overview()?.libraries ?? [];
    const source =
      tab === 'all' || !this.tabs().some((t) => t.id === tab)
        ? this.items()
        : (libraries.find((l) => l.id === tab)?.recent ?? []);
    return source.slice(0, DETAIL_COUNT);
  });

  /** What the grid lists: what the search found, else the newest of the chosen tab. */
  protected readonly listed = computed<PlexItem[]>(() => this.results() ?? (this.browse ? (this.pageOf(this.shownLibrary())?.items ?? []) : this.detailItems()));

  protected readonly shown = computed(() => (this.face().state === 'ok' ? this.items().slice(0, RECENT_POSTERS[this.size()]) : []));

  readonly face = computed<TileFace>(() => {
    const look = { icon: this.icon, hue: 'neutral' as const };
    const { target, label } = this.settings();
    const overview = this.overview();
    const status = this.plex.status(this.settings().account);
    const name = label || (target === ALL_PLEX_LIBRARIES ? (this.browse ? 'Plex library' : 'Recently added') : (this.library()?.title ?? 'Plex library'));
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
    return !this.browse && new Date(item.addedAt).getTime() > 0 ? addedOn(item.addedAt) : '';
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
    return [item.year ? `${item.year}` : null, this.length(item) || null].filter((m): m is string => !!m);
  }

  /** A movie, an episode, a track or an album plays on a TV; a show or a season is opened for what is in it. */
  protected playable(item: PlexItem) {
    return item.kind === 'movie' || item.kind === 'episode' || item.kind === 'track' || item.kind === 'album';
  }

  /** Shows have seasons, seasons episodes, albums tracks. */
  protected hasChildren(item: PlexItem) {
    return item.kind === 'show' || item.kind === 'season' || item.kind === 'album';
  }

  protected childrenTitle(item: PlexItem) {
    return item.kind === 'show' ? 'Seasons' : item.kind === 'season' ? 'Episodes' : 'Tracks';
  }

  protected childrenOf(item: PlexItem): Under {
    return this.under()[item.id] ?? {};
  }

  /** How long a track or an episode runs: 3:07, 33m. */
  protected length(item: PlexItem) {
    if (!item.durationMs) return '';
    return item.kind === 'track' ? plexTime(item.durationMs) : runtime(item.durationMs);
  }

  /** The show and season (or the artist) an opened cover is part of. */
  protected readonly crumbs = computed(() =>
    this.trail()
      .slice(0, -1)
      .map((i) => i.title)
      .join(' › '));

  /** Opens a cover of the grid for its details. */
  protected open(item: PlexItem) {
    this.trail.set([item]);
    void this.loadChildren(item);
  }

  /** Opens something under the cover on show: its season, episode or track. */
  protected push(item: PlexItem) {
    this.trail.update((t) => [...t, item]);
    void this.loadChildren(item);
  }

  /** The Plex Home's profiles, once the dialog has asked; empty for an account with no home. */
  protected readonly profiles = signal<PlexProfileList | null>(null);
  /** Gives each tile's popover and its anchor a name of their own. */
  protected readonly profilesId = `hd-plex-profiles-${nextProfilesId++}`;
  private readonly profilesPanel = viewChild<ElementRef<HTMLElement>>('profilesPanel');
  /** The profile with a PIN that is being switched to, until the PIN is given. */
  protected readonly pinFor = signal<PlexProfile | null>(null);
  protected readonly switching = signal(false);
  protected readonly profileError = signal('');

  /** Whose watching it is: the profile in use, named on the button that chooses another; nothing when the account has only one. */
  protected readonly profileName = computed(() => {
    const { profiles = [], currentId = null } = this.profiles() ?? {};
    if (profiles.length < 2) return '';
    return this.overview()?.profile ?? profiles.find((p) => p.id === currentId)?.name ?? profiles[0].name;
  });

  private async loadProfiles() {
    try {
      this.profiles.set(await this.realtime.plexProfiles(this.overview()?.accountId ?? 0));
    } catch {
      // No home, or Plex can't be reached: there is nothing to choose.
      this.profiles.set(null);
    }
  }

  /** Closed, by choosing, a press outside or Escape (the popover does that itself): the next opening starts clean. */
  protected onProfilesToggle(state: string) {
    if (state === 'open') return;
    this.pinFor.set(null);
    this.profileError.set('');
  }

  private closeProfiles() {
    this.profilesPanel()?.nativeElement.hidePopover?.();
  }

  /** A profile with a PIN asks for it first. */
  protected chooseProfile(profile: PlexProfile) {
    this.profileError.set('');
    if (profile.id === this.profiles()?.currentId) return this.closeProfiles();
    if (profile.protected) return this.pinFor.set(profile);
    void this.switchProfile(profile, null);
  }

  protected async switchProfile(profile: PlexProfile, pin: string | null) {
    this.switching.set(true);
    this.profileError.set('');
    try {
      await this.realtime.plexSelectProfile(this.overview()?.accountId ?? 0, profile.id, pin || null);
      this.closeProfiles();
      this.pinFor.set(null);
      // What was loaded was the other profile's: what it has watched, and what it may see.
      this.pages.set({});
      this.under.set({});
      this.onSearch(this.query());
      if (this.browse) void this.loadPage(this.shownLibrary());
      await this.loadProfiles();
    } catch (error) {
      this.profileError.set(reason(error, `Could not switch to ${profile.name}.`));
    } finally {
      this.switching.set(false);
    }
  }

  /** The grid of covers, which is gone while one is open. */
  private readonly pane = viewChild<ElementRef<HTMLElement>>('pane');
  private readonly injector = inject(Injector);
  /** How far the grid was scrolled, to be there again when the cover opened from it is left. */
  private paneScroll = 0;

  /** Back to the cover before, or to the grid from the first, scrolled to where it was. */
  protected back() {
    this.trail.update((t) => t.slice(0, -1));
    if (!this.trail().length) {
      const top = this.paneScroll;
      afterNextRender(() => {
        const pane = this.pane()?.nativeElement;
        if (pane) pane.scrollTop = top;
      }, { injector: this.injector });
    }
  }

  private async loadChildren(item: PlexItem) {
    if (!this.hasChildren(item) || this.under()[item.id]?.items) return;
    this.under.update((all) => ({ ...all, [item.id]: {} }));
    try {
      const items = await this.realtime.plexChildren(this.overview()?.accountId ?? 0, item.id);
      this.under.update((all) => ({ ...all, [item.id]: { items } }));
    } catch (error) {
      this.under.update((all) => ({ ...all, [item.id]: { error: reason(error, 'Could not load what is in it.') } }));
    }
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
      const account = this.overview()?.accountId ?? 0;
      // A track chosen from its album goes on with the album's next tracks.
      const trail = this.trail();
      const album = item.kind === 'track' ? trail[trail.length - 2] : undefined;
      if (album?.kind === 'album') await this.realtime.playAlbumOnAirPlay(account, album.id, item.id, device.id);
      else await this.realtime.playOnAirPlay(account, item.id, device.id);
      // From here the playing shows from AirPlayData, on this screen and every other.
      this.cast.set(IDLE);
    } catch (error) {
      this.cast.set({ ...IDLE, itemId: item.id, error: reason(error, `Could not play on ${device.name}.`) });
    }
  }

  private playTheme(show: PlexItem | null) {
    // Still in the same show: it goes on, not from the start.
    if (show && show.id === this.themeOf) return;
    this.stopTheme();
    // Nothing talks over music that already plays.
    if (!show || this.local() || this.casting().length) return;
    this.themeOf = show.id;
    this.theme = new Audio(plexAudioUrl(this.overview()?.accountId ?? 0, show.id, true));
    this.theme.volume = 0.6;
    // A show without a theme, or a browser that wants a press first, is silent.
    this.theme.play()?.catch(() => undefined);
  }

  private stopTheme() {
    this.theme?.pause();
    this.theme = undefined;
    this.themeOf = undefined;
  }

  protected videoUrl(item: PlexItem) {
    return plexVideoUrl(this.overview()?.accountId ?? 0, item.id);
  }

  /** Plays a film or episode in this screen's own picture, over the dialog. */
  private playVideo(item: PlexItem) {
    this.stopTheme();
    this.stopLocal();
    this.stopVideo();
    this.videoAt = 0;
    this.videoReportedAt = 0;
    this.video.set(item);
  }

  /** Where the video was last seen to be (ms), and when Plex was last told. */
  private videoAt = 0;
  private videoReportedAt = 0;

  /** Tells Plex where this screen's own player is, which is how it keeps what was watched. A failed report is no reason to stop. */
  private report(item: PlexItem, state: 'playing' | 'paused' | 'stopped', timeMs: number) {
    this.realtime.plexProgress(this.overview()?.accountId ?? 0, item.id, state, Math.round(timeMs), item.durationMs ?? 0).catch(() => undefined);
  }

  protected onVideo(item: PlexItem, state: 'playing' | 'paused', seconds: number) {
    this.videoAt = seconds * 1000;
    this.videoReportedAt = Date.now();
    this.report(item, state, this.videoAt);
  }

  /** While it plays Plex hears every ten seconds, so a stop that is never seen still leaves a place to resume. */
  protected onVideoTime(item: PlexItem, seconds: number) {
    this.videoAt = seconds * 1000;
    if (Date.now() - this.videoReportedAt >= VIDEO_REPORT_EVERY) {
      this.videoReportedAt = Date.now();
      this.report(item, 'playing', this.videoAt);
    }
  }

  /** Closes the video, telling Plex where it stopped: at its end when it played to it, so it counts as watched. */
  protected stopVideo(ended = false) {
    const item = this.video();
    if (!item) return;
    this.report(item, 'stopped', ended ? (item.durationMs ?? this.videoAt) : this.videoAt);
    this.video.set(null);
    this.videoAt = 0;
  }

  protected videoFailed(item: PlexItem) {
    this.video.set(null);
    this.videoAt = 0;
    this.localError.set(`Could not play ${item.title}.`);
  }

  /** Plays a film or episode in this screen's own picture; a track, or an album track after track, in its own speakers. A track chosen from its album goes on with the rest of it. */
  protected async playHere(item: PlexItem) {
    this.localError.set('');
    if (item.kind === 'movie' || item.kind === 'episode') return this.playVideo(item);
    const trail = this.trail();
    const album = item.kind === 'album' ? item : item.kind === 'track' ? trail[trail.length - 2] : undefined;
    if (album?.kind !== 'album') return this.startLocal({ queue: [item], index: 0, paused: false, album: null });
    await this.loadChildren(album);
    const tracks = (this.under()[album.id]?.items ?? []).filter((t) => t.kind === 'track');
    if (!tracks.length) return this.localError.set('That album has no tracks.');
    const index = item.kind === 'track' ? Math.max(0, tracks.findIndex((t) => t.id === item.id)) : 0;
    this.startLocal({ queue: tracks, index, paused: false, album });
  }

  /** What the track is part of: the artist, the album and its place in it; for a lone track, what the server says of it. */
  protected localDetail(play: LocalPlay) {
    const { album, index, queue } = play;
    return album
      ? `${album.subtitle ? album.subtitle + ' — ' : ''}${album.title} · ${index + 1} of ${queue.length}`
      : queue[index].subtitle;
  }

  private startLocal(play: LocalPlay) {
    this.stopTheme();
    this.audio ??= new Audio();
    const audio = this.audio;
    const fail = () => {
      this.localError.set(`Could not play ${play.queue[play.index].title}.`);
      this.stopLocal();
    };
    audio.onended = () => {
      this.reportTrack(play.queue[play.index], 'stopped', play.queue[play.index].durationMs ?? 0);
      if (play.index + 1 >= play.queue.length) this.stopLocal(false);
      else this.startLocal({ ...play, index: play.index + 1 });
    };
    audio.onerror = fail;
    audio.src = plexAudioUrl(this.overview()?.accountId ?? 0, play.queue[play.index].id);
    this.local.set(play);
    this.reportTrack(play.queue[play.index], 'playing', 0);
    audio.play()?.catch(fail);
  }

  private reportTrack(track: PlexItem, state: 'playing' | 'paused' | 'stopped', timeMs: number) {
    this.report(track, state, timeMs);
  }

  protected toggleLocal() {
    const play = this.local();
    if (!play || !this.audio) return;
    if (play.paused) this.audio.play()?.catch(() => this.stopLocal());
    else this.audio.pause();
    this.reportTrack(play.queue[play.index], play.paused ? 'playing' : 'paused', this.audio.currentTime * 1000);
    this.local.set({ ...play, paused: !play.paused });
  }

  /** Stops the music; `report` is false for a track that just ended and has told Plex already. */
  protected stopLocal(report = true) {
    const audio = this.audio;
    const play = this.local();
    if (report && play && audio) this.reportTrack(play.queue[play.index], 'stopped', audio.currentTime * 1000);
    if (audio) {
      audio.onended = audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
    }
    this.local.set(null);
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
    const tab = this.activeTab();
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
    this.stopVideo();
    this.closeProfiles();
    this.pinFor.set(null);
    this.profileError.set('');
    this.paneScroll = 0;
    this.trail.set([]);
    // Opened again, a listing is of what the library holds then.
    this.pages.set({});
    this.onSearch('');
  }


  /** Added today or yesterday. */
  protected isNew(item: PlexItem) {
    if (this.browse) return false;
    const label = addedOn(item.addedAt);
    return label === 'Today' || label === 'Yesterday';
  }
}
