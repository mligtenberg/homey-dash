// Mirrors apps/api/News (ADR-0016).

/** A news source a tile (`settings.source`) or lock screen widget (`source`) can show; the first is the default. */
export interface NewsSourceInfo {
  id: string;
  name: string;
}

export const NEWS_SOURCES: readonly NewsSourceInfo[] = [
  { id: 'nos', name: 'NOS Nieuws' },
  { id: 'nos-binnenland', name: 'NOS Binnenland' },
  { id: 'nos-buitenland', name: 'NOS Buitenland' },
  { id: 'nos-economie', name: 'NOS Economie' },
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
