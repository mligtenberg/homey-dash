import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { AirPlayDevice, NEWS_SOURCES, NewsApi, Realtime, NewsFeed, NewsItem, NewsLive, NewsVideo, newsArticleUrl } from '@homey-dash/api-client';
import { LucideChevronLeft } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { AirPlayCast, AirPlayNowControls } from '../core/airplay-cast';
import { SegmentedStrip, StripOption } from '../core/segmented-strip';
import { TileDetails } from '../core/tile-details';
import { NewsPlayer } from './news-player';
import { AirPlayData } from '../plex/airplay-data';
import { ago, NewsData } from './news-data';

/** What the reader view says to the screen when someone touches the story inside its frame. */
const ACTIVE = 'hd-news-active';

/** How often the livestreams are looked at again while they are shown (ms). */
const LIVE_EVERY = 60_000;

/** The tabs: what NOS has under its menu, `live` and `videos` and then every feed. */
const LIVE = 'live';
const VIDEOS = 'videos';

/** The tab of a feed, named as NOS names it. */
const FEED_TABS = NEWS_SOURCES.map((s) => ({ id: s.id, name: s.id === 'nos' ? 'Laatste nieuws' : s.name.replace(/^NOS\s+/, '') }));

type View =
  | { kind: 'article'; source: string; item: NewsItem }
  | { kind: 'video'; id: string; title: string; description: string | null; url: string | null; error?: string }
  | { kind: 'live'; id: string; title: string; description: string | null; url: string; error?: string };

/** Whether the screen is in its dark theme. */
function isDark(): boolean {
  const theme = document.documentElement.dataset['theme'];
  return theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

/** `1:50`, `12:03`. */
export function duration(seconds: number | null): string {
  if (seconds == null) return '';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** `19:50`. */
function clock(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}

/**
 * What a news tile's detail view holds (ADR-0016): tabs for NOS's livestreams, videos and every feed, the stories of the one
 * picked, and a story, video or livestream opened over them with a way back. A story shows as a reader view in a frame (NOS
 * itself refuses to be framed); videos and livestreams play from NOS's own streams.
 */
@Component({
  selector: 'hd-news-browser',
  imports: [AirPlayCast, AirPlayNowControls, LucideDynamicIcon, NewsPlayer, SegmentedStrip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-news__browser' },
  template: `
    <div class="hd-news__bar">
      @if (view(); as open) {
        <button type="button" class="hd-news__back" (click)="close()">
          <svg [lucideIcon]="backIcon" aria-hidden="true" />
          {{ backLabel() }}
        </button>
        <div class="hd-news__open-title">{{ openTitle() }}</div>
      } @else {
        <hd-segmented-strip label="News" [options]="tabs()" [value]="tab()" (picked)="pick($event)" />
      }
    </div>

    @for (p of casting(); track p.deviceId) {
      <hd-airplay-now [playing]="p" />
    }

    @if (view(); as open) {
      @switch (open.kind) {
        @case ('article') {
          <iframe #reader class="hd-news__reader" [src]="readerUrl()" sandbox="allow-scripts" [title]="open.item.title"></iframe>
        }
        @default {
          <div class="hd-news__watch">
            @if (streamUrl(); as url) {
              <hd-news-player [url]="url" [title]="openTitle()" (active)="details?.stayOpen()" />
            } @else if (watching()?.error) {
              <div class="hd-note">{{ watching()?.error }}</div>
            } @else {
              <div class="hd-note">Starting the stream…</div>
            }
            @if (watching(); as w) {
              <hd-airplay-cast [start]="castStart()" (started)="close()" />
            }
            @if (watching()?.description; as text) {
              <p class="hd-news__watch-text">{{ text }}</p>
            }
          </div>
        }
      }
    } @else if (tab() === live) {
      <div class="hd-news__pane">
        @for (stream of lives(); track stream.id; let first = $first) {
          <button type="button" class="hd-news__story" [class.is-lead]="first && stream.live" [class.is-soon]="!stream.live" [disabled]="!stream.live" (click)="watchLive(stream)">
            @if (stream.image) {
              <span class="hd-news__thumb">
                <img class="hd-news__photo" [src]="stream.image" alt="" loading="lazy" draggable="false" />
                @if (stream.live) {
                  <span class="hd-news__badge hd-news__badge--live">Live</span>
                }
              </span>
            }
            <span class="hd-news__story-age" [class.is-live]="stream.live">{{ stream.live ? 'Live now' : 'Starts ' + clock(stream.startAt) }}</span>
            <span class="hd-news__headline">{{ stream.title }}</span>
            @if (stream.description) {
              <span class="hd-news__summary">{{ stream.description }}</span>
            }
          </button>
        } @empty {
          <div class="hd-note">{{ livesLoaded() ? 'No livestreams right now' : 'Loading…' }}</div>
        }
      </div>
    } @else if (tab() === videosTab) {
      <div class="hd-news__pane">
        @for (video of videos(); track video.id) {
          <button type="button" class="hd-news__story" (click)="watchVideo(video)">
            @if (video.image) {
              <span class="hd-news__thumb">
                <img class="hd-news__photo" [src]="video.image" alt="" loading="lazy" draggable="false" />
                @if (video.seconds !== null) {
                  <span class="hd-news__badge">{{ duration(video.seconds) }}</span>
                }
              </span>
            }
            <span class="hd-news__story-age">{{ video.age }}@if (video.category) { · {{ video.category }} }</span>
            <span class="hd-news__headline">{{ video.title }}</span>
          </button>
        } @empty {
          <div class="hd-note">{{ videosLoaded() ? 'No videos' : 'Loading…' }}</div>
        }
      </div>
    } @else {
      <div class="hd-news__pane">
        @for (story of stories(); track story.title; let first = $first) {
          <button type="button" class="hd-news__story" [class.is-lead]="first" [disabled]="!story.link" (click)="read(story)">
            @if (story.image) {
              <img class="hd-news__photo" [src]="story.image" alt="" loading="lazy" draggable="false" />
            }
            <span class="hd-news__story-age">{{ story.age }}</span>
            <span class="hd-news__headline">{{ story.title }}</span>
            @if (story.summary) {
              <span class="hd-news__summary">{{ story.summary }}</span>
            }
          </button>
        } @empty {
          <div class="hd-note">{{ feedNote() }}</div>
        }
      </div>
    }
  `,
})
export class NewsBrowser {
  /** The source of the tile, which the tab it opens on shows. */
  readonly source = input.required<string>();

  private readonly news = inject(NewsData);
  private readonly api = inject(NewsApi);
  private readonly realtime = inject(Realtime);
  private readonly airPlay = inject(AirPlayData);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly now = signal(Date.now());
  private readonly reader = viewChild<ElementRef<HTMLIFrameElement>>('reader');
  protected readonly details = inject(TileDetails, { optional: true });

  protected readonly live = LIVE;
  protected readonly videosTab = VIDEOS;
  protected readonly backIcon = LucideChevronLeft;
  protected readonly duration = duration;
  protected readonly clock = clock;

  private readonly picked = signal<string | null>(null);
  /** The tab shown: the one picked, else the tile's own feed. */
  protected readonly tab = computed(() => this.picked() ?? this.source());
  protected readonly view = signal<View | null>(null);
  protected readonly streamUrl = computed(() => {
    const view = this.view();
    return view && view.kind !== 'article' ? view.url : null;
  });
  protected readonly watching = computed(() => {
    const view = this.view();
    return view && view.kind !== 'article' ? view : null;
  });

  /** Feeds other than the tile's own, as they were read: by source. */
  private readonly feeds = signal<Record<string, NewsFeed>>({});
  protected readonly lives = signal<NewsLive[]>([]);
  protected readonly livesLoaded = signal(false);
  private readonly videoList = signal<NewsVideo[]>([]);
  protected readonly videosLoaded = signal(false);

  /** The tabs, in the order of nos.nl's menu; Live has a dot while something is on. */
  protected readonly tabs = computed<StripOption<string>[]>(() => [
    { id: LIVE, label: 'Live', marked: this.lives().some((l) => l.live) },
    { id: VIDEOS, label: "Video's" },
    ...FEED_TABS.map((t) => ({ id: t.id, label: t.name })),
  ]);

  protected readonly stories = computed(() => {
    const now = this.now();
    const id = this.tab();
    const feed = id === this.source() ? this.news.feed(id) : this.feeds()[id];
    return (feed?.items ?? []).map((i) => ({ ...i, age: ago(i.publishedAt, now) }));
  });

  protected readonly videos = computed(() => {
    const now = this.now();
    return this.videoList().map((v) => ({ ...v, age: ago(v.publishedAt, now) }));
  });

  protected readonly feedNote = computed(() => {
    const feed = this.tab() === this.source() ? this.news.feed(this.tab()) : this.feeds()[this.tab()];
    return !feed || feed.status === 'loading' ? 'Loading…' : (feed.error ?? 'No stories');
  });

  /** What plays on an Apple TV from here, on every screen. */
  protected readonly casting = computed(() => this.airPlay.playing().filter((p) => p.source === 'nos'));

  /** Plays what is open on the Apple TV picked; a video needs its stream first, which the API gets itself. */
  protected readonly castStart = computed(() => {
    const view = this.view();
    return (device: AirPlayDevice) =>
      view?.kind === 'video' || view?.kind === 'live' ? this.realtime.playNewsOnAirPlay(view.kind, view.id, device.id) : Promise.reject(new Error('Nothing is open.'));
  });

  protected readonly backLabel = computed(() => {
    const view = this.view();
    return view?.kind === 'article' ? 'All news' : view?.kind === 'live' ? 'Live' : "Video's";
  });

  protected readonly openTitle = computed(() => {
    const view = this.view();
    return !view ? '' : view.kind === 'article' ? view.item.title : view.title;
  });

  protected readonly readerUrl = computed(() => {
    const view = this.view();
    if (view?.kind !== 'article' || !view.item.link) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(newsArticleUrl(view.source, view.item.link, view.item.publishedAt, isDark()));
  });

  constructor() {
    const clockTimer = setInterval(() => this.now.set(Date.now()), 60_000);
    const liveTimer = setInterval(() => this.tab() === LIVE && !this.view() && void this.loadLive(), LIVE_EVERY);
    // A view nobody touches closes by itself; touches inside the story's frame never reach it, so its page reports them.
    const onMessage = (event: MessageEvent) => {
      if (event.data === ACTIVE && event.source === this.reader()?.nativeElement.contentWindow) this.details?.stayOpen();
    };
    addEventListener('message', onMessage);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(clockTimer);
      clearInterval(liveTimer);
      removeEventListener('message', onMessage);
    });
    // Looks for the livestreams in the background, so Live shows its dot.
    void this.loadLive();
  }

  protected pick(id: string) {
    this.picked.set(id);
    const content = document.querySelector('.hd-news__pane');
    content?.scrollTo?.({ top: 0 });
    if (id === LIVE) void this.loadLive();
    else if (id === VIDEOS) void this.loadVideos();
    else if (id !== this.source() && !this.feeds()[id]) void this.loadFeed(id);
  }

  protected read(item: NewsItem) {
    this.view.set({ kind: 'article', source: this.tab(), item });
  }

  protected watchLive(stream: NewsLive) {
    this.view.set({ kind: 'live', id: stream.id, title: stream.title, description: stream.description, url: stream.url });
  }

  protected async watchVideo(video: NewsVideo) {
    this.view.set({ kind: 'video', id: video.id, title: video.title, description: video.description, url: null });
    try {
      const { url } = await firstValueFrom(this.api.videoStream(video.id));
      this.view.update((v) => (v?.kind === 'video' && v.id === video.id ? { ...v, url } : v));
    } catch {
      this.view.update((v) => (v?.kind === 'video' && v.id === video.id ? { ...v, error: 'NOS has no stream for this video.' } : v));
    }
  }

  protected close() {
    this.view.set(null);
  }

  private async loadFeed(id: string) {
    try {
      const feed = await firstValueFrom(this.api.feed(id));
      this.feeds.update((all) => ({ ...all, [id]: feed }));
    } catch {
      this.feeds.update((all) => ({ ...all, [id]: { source: id, name: id, status: 'disconnected', error: 'Cannot reach HomeyDash.', items: [], updatedAt: null } }));
    }
  }

  private async loadLive() {
    try {
      this.lives.set(await firstValueFrom(this.api.live()));
    } catch {
      // Kept as it was; the next look tries again.
    }
    this.livesLoaded.set(true);
  }

  private async loadVideos() {
    try {
      this.videoList.set(await firstValueFrom(this.api.videos()));
    } catch {
      // The list stays empty, which says so.
    }
    this.videosLoaded.set(true);
  }
}
