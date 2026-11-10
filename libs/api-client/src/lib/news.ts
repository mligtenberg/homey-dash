import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

// Mirrors apps/api/News (ADR-0016).

/** A news source a tile (`settings.source`) or lock screen widget (`source`) can show; the first is the default. */
export interface NewsSourceInfo {
  id: string;
  name: string;
}

export const NEWS_SOURCES: readonly NewsSourceInfo[] = [
  { id: 'nos', name: 'NOS Nieuws' },
  { id: 'nos-politiek', name: 'NOS Politiek' },
  { id: 'nos-binnenland', name: 'NOS Binnenland' },
  { id: 'nos-buitenland', name: 'NOS Buitenland' },
  { id: 'nos-economie', name: 'NOS Economie' },
  { id: 'nos-koningshuis', name: 'NOS Koningshuis' },
  { id: 'nos-cultuur', name: 'NOS Cultuur & media' },
  { id: 'nos-opmerkelijk', name: 'NOS Opmerkelijk' },
  { id: 'nos-sport', name: 'NOS Sport' },
  { id: 'nos-tech', name: 'NOS Tech' },
];

export const DEFAULT_NEWS_SOURCE = NEWS_SOURCES[0].id;

/** One story. */
export interface NewsItem {
  title: string;
  summary: string | null;
  link: string | null;
  image: string | null;
  publishedAt: string | null;
}

/** The latest stories of one source, newest first. `disconnected`: the feed can't be reached (the last stories stay). */
export interface NewsFeed {
  source: string;
  name: string;
  status: 'loading' | 'connected' | 'disconnected';
  error: string | null;
  items: NewsItem[];
  updatedAt: string | null;
}

/** A story as a reader view from HomeyDash, for a frame: NOS refuses to be framed itself (ADR-0016). */
export function newsArticleUrl(source: string, link: string, publishedAt: string | null, dark: boolean) {
  return `/api/news/article?source=${encodeURIComponent(source)}&link=${encodeURIComponent(link)}${publishedAt ? `&at=${encodeURIComponent(publishedAt)}` : ''}${dark ? '&dark=true' : ''}`;
}

/** A livestream of NOS, on now or coming; `url` is its HLS stream. */
export interface NewsLive {
  id: string;
  title: string;
  description: string | null;
  startAt: string | null;
  endAt: string | null;
  image: string | null;
  url: string;
  live: boolean;
}

/** A video of NOS; its stream comes from `NewsApi.videoStream`. */
export interface NewsVideo {
  id: string;
  title: string;
  description: string | null;
  seconds: number | null;
  image: string | null;
  publishedAt: string | null;
  category: string | null;
}

/** What a news tile's detail view asks HomeyDash on its own: any source's stories, NOS's livestreams and videos (ADR-0016). */
@Injectable({ providedIn: 'root' })
export class NewsApi {
  private readonly http = inject(HttpClient);

  /** The stories of any source; `status` is `disconnected` (with `error`) when NOS can't be read. */
  feed(source: string) {
    return this.http.get<NewsFeed>(`/api/news/feed?source=${encodeURIComponent(source)}`);
  }

  /** The livestreams on now, then those coming. */
  live() {
    return this.http.get<NewsLive[]>('/api/news/live');
  }

  /** The newest videos. */
  videos() {
    return this.http.get<NewsVideo[]>('/api/news/videos');
  }

  /** Where a video plays from (HLS). */
  videoStream(id: string) {
    return this.http.get<{ url: string }>(`/api/news/video/${encodeURIComponent(id)}`);
  }
}
