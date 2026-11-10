import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NewsFeed, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { TileSize } from '@homey-dash/layout';
import { RealtimeTileData } from '../realtime-tile-data';
import { TileData } from '../tile-data';
import { ago, NewsData } from './news-data';
import { NewsTile } from './news-tile';
import { NEWS_TILES } from './news-tiles';

const item = (title: string, minutesAgo: number) => ({
  title,
  summary: null,
  link: `https://nos.nl/artikel/${title}`,
  image: null,
  publishedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
});

const feed = (change: Partial<NewsFeed> = {}): NewsFeed => ({
  source: 'nos',
  name: 'NOS Nieuws',
  status: 'connected',
  error: null,
  items: [item('First', 5), item('Second', 70), item('Third', 300)],
  updatedAt: null,
  ...change,
});

// jsdom has no modal dialogs, and no media queries.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  window.matchMedia ??= (() => ({ matches: false })) as unknown as typeof window.matchMedia;
});

describe('News tile', () => {
  let realtime: FakeRealtime;

  beforeEach(() => {
    realtime = new FakeRealtime();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Realtime, useValue: realtime },
        { provide: TileData, useExisting: RealtimeTileData },
      ],
    });
  });

  const settle = () => TestBed.inject(ApplicationRef).whenStable();

  async function render(size: TileSize, settings: Record<string, unknown> = { target: null }) {
    TestBed.inject(NewsData); // Connects, so pushes reach it.
    await settle();
    const fixture = TestBed.createComponent(NewsTile);
    fixture.componentRef.setInput('settings', settings);
    fixture.componentRef.setInput('size', size);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  const titles = (tile: HTMLElement) => [...tile.querySelectorAll('.hd-news__title')].map((t) => t.textContent?.trim());

  it('is a kind of its own that points at nothing in Homey', () => {
    expect(NEWS_TILES.kinds.map((k) => [k.id, k.target])).toEqual([['news', 'none']]);
  });

  it('shows as many headlines as the size has room for', async () => {
    realtime.newsList = [feed()];

    expect(titles(await render('small'))).toEqual(['First']);
  });

  it('shows more headlines on a larger tile', async () => {
    realtime.newsList = [feed()];

    expect(titles(await render('large'))).toEqual(['First', 'Second', 'Third']);
  });

  it('shows the feed a tile names', async () => {
    realtime.newsList = [feed(), feed({ source: 'nos-sport', name: 'NOS Sport', items: [item('Goal', 1)] })];

    const tile = await render('wide', { target: null, source: 'nos-sport' });

    expect(titles(tile)).toEqual(['Goal']);
    expect(tile.querySelector('.hd-tile__name')?.textContent).toContain('Sport');
  });

  it('opens every story over the whole screen, and one as a reader view in a frame with a way back', async () => {
    realtime.newsList = [feed()];
    const tile = await render('small');
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    const stories = () => [...tile.querySelectorAll<HTMLButtonElement>('.hd-news__story')];
    expect(stories().map((s) => s.querySelector('.hd-news__headline')?.textContent)).toEqual(['First', 'Second', 'Third']);

    stories()[1].click();
    await settle();
    const frame = tile.querySelector<HTMLIFrameElement>('iframe.hd-news__reader');
    expect(frame?.getAttribute('src')).toEqual(expect.stringMatching(/^\/api\/news\/article\?source=nos&link=https%3A%2F%2Fnos\.nl%2Fartikel%2FSecond&at=/));
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');

    (tile.querySelector('.hd-news__back') as HTMLButtonElement).click();
    await settle();
    expect(tile.querySelector('iframe')).toBeNull();
    expect(stories()).toHaveLength(3);
  });

  it('says why there is nothing to show', async () => {
    realtime.newsList = [feed({ status: 'disconnected', error: 'Cannot reach NOS Nieuws.', items: [] })];

    const tile = await render('wide');

    expect(tile.textContent).toContain('Cannot reach NOS Nieuws.');
  });

  it('says how long ago a story came out', () => {
    const now = Date.now();
    const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

    expect([ago(at(0), now), ago(at(12), now), ago(at(180), now), ago(at(3000), now), ago(null, now)]).toEqual(['now', '12 min', '3 h', '2 d', '']);
  });
});
