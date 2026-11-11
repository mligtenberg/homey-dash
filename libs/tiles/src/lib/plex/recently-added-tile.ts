import { AirPlayReceivers } from '../core/airplay-cast';
import { Segmented } from '../core/segmented';
import { reason } from './hub-reason';
import { PlexAirPlayControls } from './plex-airplay-controls';
import { PlexLocalPlayer } from './plex-local-player';
import { PlexProfilePicker } from './plex-profile-picker';
import { PlexTileView } from './plex-tile-view';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, signal, untracked, viewChild } from '@angular/core';
import { AirPlayDevice, ALL_PLEX_LIBRARIES, PlexActor, PlexItem, PlexLibrary, plexAudioUrl, plexImageUrl, plexVideoUrl } from '@homey-dash/api-client';
import { cells } from '@homey-dash/layout';
import { LucideAirplay, LucideCheck, LucideChevronLeft, LucideClapperboard, LucideLibrary, LucideLock, LucidePause, LucidePlay, LucideSquare, LucideTv, LucideStar, LucideVolume2 } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST, TileFace } from '../core/tile-view';
import { AirPlayData } from './airplay-data';
import { plexIdle, plexTime } from './plex-data';


/** How many items the detail view lists. */
const DETAIL_COUNT = 24;

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
  step: 'idle' | 'choosing' | 'starting';
  /** The cover it is for. */
  itemId?: string;
  device?: AirPlayDevice;
  error?: string;
}

const IDLE: Cast = { step: 'idle' };

/** What is under a show, season or album: nothing while it loads. */
interface Under {
  items?: PlexItem[];
  error?: string;
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
            (ended)="videoEnded(v)"
            (error)="videoFailed(v)"
          ></video>
          <div class="hd-plex-recent__player-bar">
            <strong>{{ v.title }}</strong>
            <button type="button" class="hd-plex-recent__receiver" (click)="stopVideo()"><svg [lucideIcon]="stopIcon" />Stop</button>
          </div>
        </div>
      }
      @if (!selected() && tabs().length > (browse ? 1 : 2)) {
        <hd-segmented hdDetailsHead label="Show" [options]="tabs()" [value]="activeTab()" (picked)="selectTab($event)" />
      }
      @if (player.play(); as l) {
        <div class="hd-plex-recent__now" role="group" aria-label="Playing here">
          <div class="hd-plex-recent__now-text">
            <strong>{{ l.queue[l.index].title }}</strong>
            @if (player.detail(l); as detail) {
              <span>{{ detail }}</span>
            }
            <span>{{ l.paused ? 'Paused here' : 'Playing here' }}</span>
          </div>
          <button type="button" class="hd-plex-recent__receiver" (click)="player.toggle()">
            <svg [lucideIcon]="l.paused ? playIcon : pauseIcon" />{{ l.paused ? 'Resume' : 'Pause' }}
          </button>
          <button type="button" class="hd-plex-recent__receiver" (click)="player.stop()"><svg [lucideIcon]="stopIcon" />Stop</button>
        </div>
      }
      @for (p of casting(); track p.deviceId) {
        <hd-plex-airplay-controls [playing]="p" />
      }
      @if (selected(); as item) {
        @if (item.art) {
          <img class="hd-plex-recent__backdrop" [src]="artUrl(item.art)" alt="" draggable="false" />
        }
        <div class="hd-plex-recent__detail">
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
                  @case ('choosing') {
                    <hd-airplay-receivers (chosen)="playOn(item, $event)" (cancelled)="cancelCast()" />
                  }
                }
                @if (c.error) {
                  <div class="hd-plex-recent__cast-error" role="alert">{{ c.error }}</div>
                }
                @if (player.error(); as error) {
                  <div class="hd-plex-recent__cast-error" role="alert">{{ error }}</div>
                }
              </div>
            }
          </div>
          @if (castOf(item); as people) {
            <div class="hd-plex-recent__children">
              <h4 class="hd-plex-recent__section">Cast</h4>
              <ul class="hd-plex-recent__people">
                @for (person of people; track $index) {
                  <li>
                    <div class="hd-plex-recent__face">
                      @if (person.image) {
                        <img [src]="faceUrl(person.image)" alt="" loading="lazy" draggable="false" />
                      } @else {
                        {{ initials(person.name) }}
                      }
                    </div>
                    <div class="hd-plex-recent__card-title">{{ person.name }}</div>
                    @if (person.role) {
                      <div class="hd-plex-recent__card-sub">{{ person.role }}</div>
                    }
                  </li>
                }
              </ul>
            </div>
          }
          @if (hasChildren(item)) {
            @let under = childrenOf(item);
            <div class="hd-plex-recent__children">
              <h4 class="hd-plex-recent__section">{{ childrenTitle(item) }}</h4>
              @if (under.error) {
                <div class="hd-note hd-plex-recent__empty" role="alert">{{ under.error }}</div>
              } @else if (!under.items) {
                <div class="hd-note hd-plex-recent__empty">Loading…</div>
              } @else if (!under.items.length) {
                <div class="hd-note hd-plex-recent__empty">Nothing here</div>
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
          <hd-plex-profile-picker [accountId]="accountId()" [current]="overview()?.profile" [active]="!!details()?.isOpen()" (switched)="onProfileSwitched()" />
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
            <div class="hd-note hd-plex-recent__empty">
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
  imports: [TileDetails, LucideDynamicIcon, AirPlayReceivers, PlexAirPlayControls, PlexProfilePicker, Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-plex-recent', '[class.has-art]': 'shown().length > 0' },
  template: PLEX_BROWSER_TEMPLATE,
})
export class RecentlyAddedTile extends PlexTileView {
  /** Whether this lists everything a library holds, a page at a time (the library tile), instead of the newest. */
  protected readonly browse: boolean = false;
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
  protected readonly lockIcon = LucideLock;

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
  /** The actors with their pictures, which Plex gives for the one item and not in a list; until then the list's names. */
  private readonly casts = signal<Record<string, PlexActor[]>>({});
  private readonly cast = signal<Cast>(IDLE);

  /** What plays on AirPlay now for this account, wherever it was started: its controls stay on show. */
  protected readonly casting = computed(() => this.airPlay.playing().filter((p) => p.source !== 'nos' && p.accountId === this.accountId()));
  protected readonly allPaused = computed(() => this.casting().every((p) => p.paused));
  /** Receivers whose stream is being started over with another track. */

  protected readonly query = signal('');
  /** What the search found; null when nothing is being searched for. */
  protected readonly results = signal<PlexItem[] | null>(null);
  protected readonly searching = signal(false);
  protected readonly searchError = signal('');
  private searchTimer?: ReturnType<typeof setTimeout>;

  /** Music playing on this screen, which goes on when the cover is closed. */
  protected readonly player = new PlexLocalPlayer(
    () => this.accountId(),
    (track, state, timeMs) => this.report(track, state, timeMs),
    () => this.stopTheme(),
  );
  private theme?: HTMLAudioElement;
  private themeOf?: string;

  /** The film or episode playing in this screen's own picture, over the dialog. */
  protected readonly video = signal<PlexItem | null>(null);

  /** What the tile's face says plays: on an Apple TV, or here. */
  protected readonly badge = computed(() => {
    const local = this.player.play();
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
      const page = await this.realtime.plexLibraryItems(this.accountId(), id, have.length, PAGE);
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
    // A show's theme plays from opening the show and goes on through its seasons and episodes; it stops when the show is left.
    effect(() => {
      const root = this.trail()[0];
      untracked(() => this.playTheme(root?.kind === 'show' ? root : null));
    });
    // Once something actually plays on an Apple TV the theme gives way; it does not come back for the same show.
    effect(() => {
      if (this.casting().length) untracked(() => this.silenceTheme());
    });
    inject(DestroyRef).onDestroy(() => {
      this.stopTheme();
      this.player.stop();
      this.stopVideo();
    });
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

  protected readonly shown = computed(() => (this.face().state === 'ok' ? this.items().slice(0, cells(this.size())) : []));

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
    return plexImageUrl(this.accountId(), path, 400, 600);
  }

  /** When it was added; nothing when the server didn't say (a search result without a date). */
  protected added(item: PlexItem) {
    return !this.browse && new Date(item.addedAt).getTime() > 0 ? addedOn(item.addedAt) : '';
  }

  protected castOf(item: PlexItem) {
    const people = this.casts()[item.id] ?? item.cast;
    return people?.length ? people : null;
  }

  protected faceUrl(path: string) {
    return plexImageUrl(this.accountId(), path, 200, 200);
  }

  /** What a face shows when Plex has no picture of the person. */
  protected initials(name: string) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }

  protected artUrl(path: string) {
    return plexImageUrl(this.accountId(), path, 1280, 720);
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

  /** What was loaded was the other profile's: what it has watched, and what it may see. */
  protected onProfileSwitched() {
    this.pages.set({});
    this.under.set({});
    this.onSearch(this.query());
    if (this.browse) void this.loadPage(this.shownLibrary());
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

  private async loadCast(item: PlexItem) {
    if (this.casts()[item.id] || !['movie', 'show', 'episode'].includes(item.kind)) return;
    try {
      const people = await this.realtime.plexCast(this.accountId(), item.id);
      this.casts.update((all) => ({ ...all, [item.id]: people }));
    } catch {
      // The names from the list stay.
    }
  }

  private async loadChildren(item: PlexItem) {
    void this.loadCast(item);
    if (!this.hasChildren(item) || this.under()[item.id]?.items) return;
    this.under.update((all) => ({ ...all, [item.id]: {} }));
    try {
      const items = await this.realtime.plexChildren(this.accountId(), item.id);
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

  /** Back from choosing an Apple TV to the Play buttons. */
  protected cancelCast() {
    this.cast.set(IDLE);
  }

  protected findReceivers(item: PlexItem) {
    this.cast.set({ step: 'choosing', itemId: item.id });
  }

  protected async playOn(item: PlexItem, device: AirPlayDevice) {
    this.cast.set({ step: 'starting', itemId: item.id, device });
    try {
      const account = this.accountId();
      // A track chosen from its album goes on with the album's next tracks, an episode with the season's next episodes.
      const trail = this.trail();
      const parent = item.kind === 'track' || item.kind === 'episode' ? trail[trail.length - 2] : undefined;
      if ((item.kind === 'track' && parent?.kind === 'album') || (item.kind === 'episode' && parent?.kind === 'season'))
        await this.realtime.playAlbumOnAirPlay(account, parent.id, item.id, device.id);
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
    if (!show || this.player.play() || this.casting().length) return;
    this.themeOf = show.id;
    this.theme = new Audio(plexAudioUrl(this.accountId(), show.id, true));
    this.theme.volume = 0.6;
    // A show without a theme, or a browser that wants a press first, is silent.
    this.theme.play()?.catch(() => undefined);
  }

  /** Stops the theme but remembers its show, so staying in the show does not start it over. */
  private silenceTheme() {
    this.theme?.pause();
    this.theme = undefined;
  }

  private stopTheme() {
    this.theme?.pause();
    this.theme = undefined;
    this.themeOf = undefined;
  }

  protected videoUrl(item: PlexItem) {
    return plexVideoUrl(this.accountId(), item.id);
  }

  /** Plays a film or episode in this screen's own picture, over the dialog. */
  private playVideo(item: PlexItem, next: PlexItem[] = []) {
    this.stopTheme();
    this.player.stop();
    this.stopVideo();
    this.videoNext = next;
    this.videoAt = 0;
    this.videoReportedAt = 0;
    this.video.set(item);
  }

  /** The episodes after the one that plays, in this screen's picture, which follow when it ends. */
  private videoNext: PlexItem[] = [];

  /** An episode that played to its end goes on with the next of its season. */
  protected videoEnded(item: PlexItem) {
    const next = this.videoNext.shift();
    this.stopVideo(true);
    if (next) this.playVideo(next, this.videoNext);
  }

  /** Where the video was last seen to be (ms), and when Plex was last told. */
  private videoAt = 0;
  private videoReportedAt = 0;

  /** Tells Plex where this screen's own player is, which is how it keeps what was watched. A failed report is no reason to stop. */
  private report(item: PlexItem, state: 'playing' | 'paused' | 'stopped', timeMs: number) {
    this.realtime.plexProgress(this.accountId(), item.id, state, Math.round(timeMs), item.durationMs ?? 0).catch(() => undefined);
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
    this.player.error.set(`Could not play ${item.title}.`);
  }

  /** Plays a film or episode in this screen's own picture; a track, or an album track after track, in its own speakers. A track chosen from its album goes on with the rest of it. */
  protected async playHere(item: PlexItem) {
    this.player.error.set('');
    const trail = this.trail();
    if (item.kind === 'movie') return this.playVideo(item);
    if (item.kind === 'episode') {
      const season = trail[trail.length - 2];
      const episodes = season?.kind === 'season' ? (this.under()[season.id]?.items ?? []).filter((e) => e.kind === 'episode') : [];
      const at = episodes.findIndex((e) => e.id === item.id);
      return this.playVideo(item, at < 0 ? [] : episodes.slice(at + 1));
    }
    const album = item.kind === 'album' ? item : item.kind === 'track' ? trail[trail.length - 2] : undefined;
    if (album?.kind !== 'album') return this.player.start({ queue: [item], index: 0, paused: false, album: null });
    await this.loadChildren(album);
    const tracks = (this.under()[album.id]?.items ?? []).filter((t) => t.kind === 'track');
    if (!tracks.length) return this.player.error.set('That album has no tracks.');
    const index = item.kind === 'track' ? Math.max(0, tracks.findIndex((t) => t.id === item.id)) : 0;
    this.player.start({ queue: tracks, index, paused: false, album });
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
      const found = await this.realtime.searchPlex(this.accountId(), query, library);
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
