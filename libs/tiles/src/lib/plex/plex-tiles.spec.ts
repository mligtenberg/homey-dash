import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlexItem, PlexOverview, PlexSession, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { TileSize } from '@homey-dash/layout';
import { RealtimeTileData } from '../realtime-tile-data';
import { TileData } from '../tile-data';
import { NowPlayingTile } from './now-playing-tile';
import { PLEX_TILES } from './plex-tiles';
import { LivePlexSession, PlexData, plexPosition, plexTime } from './plex-data';
import { addedOn, RecentlyAddedTile } from './recently-added-tile';

const session = (change: Partial<PlexSession> = {}): PlexSession => ({
  id: '1',
  kind: 'movie',
  title: 'Dune: Part Two',
  subtitle: '2024',
  image: '/library/metadata/101/thumb',
  art: '/library/metadata/101/art',
  durationMs: 10_000_000,
  offsetMs: 3_600_000,
  at: '2026-10-31T20:00:00Z',
  state: 'playing',
  user: 'Martin',
  playerId: 'tv',
  playerName: 'Living room TV',
  ...change,
});

const item = (n: number, addedAt: string): PlexItem => ({
  id: `${n}`,
  kind: 'movie',
  title: `Movie ${n}`,
  subtitle: null,
  image: `/library/metadata/${n}/thumb`,
  addedAt,
});

const overview = (change: Partial<PlexOverview> = {}): PlexOverview => ({
  status: 'connected',
  error: null,
  loaded: true,
  libraries: [
    { id: '1', title: 'Movies', type: 'movie', recent: [item(1, '2026-10-30T10:00:00Z'), item(2, '2026-10-20T10:00:00Z')] },
    { id: '2', title: 'TV Shows', type: 'show', recent: [item(3, '2026-10-31T10:00:00Z')] },
  ],
  players: [{ id: 'tv', name: 'Living room TV' }],
  ...change,
});

const button = (root: Element, label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label) as HTMLElement;

describe('Plex tiles', () => {
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

  async function render(component: Type<unknown>, target: string | null, size: TileSize = 'wide') {
    TestBed.inject(PlexData); // Connects, so pushes reach it.
    await settle();
    const fixture = TestBed.createComponent(component);
    fixture.componentRef.setInput('settings', { target });
    fixture.componentRef.setInput('size', size);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  describe('now playing tile', () => {
    it('shows what plays over its artwork, and pauses it from its button', async () => {
      realtime.plexSnapshot = { overview: overview(), sessions: [session()] };
      const tile = await render(NowPlayingTile, 'plex-player:any');

      expect(tile.classList).toContain('has-art');
      expect(tile.querySelector('.hd-plex__title')?.textContent?.trim()).toBe('Dune: Part Two');
      expect(tile.querySelector('img')?.getAttribute('src')).toContain(encodeURIComponent('/library/metadata/101/art'));
      button(tile, 'Pause').click();
      await settle();

      expect(realtime.commands).toContainEqual(['controlPlex', 'tv', 'pause']);
    });

    it('follows only its own player', async () => {
      realtime.plexSnapshot = { overview: overview(), sessions: [session({ playerId: 'ipad', playerName: 'iPad' })] };

      const tile = await render(NowPlayingTile, 'plex-player:tv');

      expect(tile.classList).not.toContain('has-art');
      expect(tile.textContent).toContain('Living room TV');
      expect(tile.textContent).toContain('Nothing playing');
    });

    it('says when Plex is not set up', async () => {
      realtime.plexSnapshot = { overview: overview({ status: 'notSetUp', loaded: false, libraries: [], players: [] }), sessions: [] };

      const tile = await render(NowPlayingTile, 'plex-player:any');

      expect(tile.textContent).toContain('Plex is not set up');
      expect(tile.classList).toContain('is-unavailable');
    });

    it('starts showing a session as soon as it is pushed', async () => {
      realtime.plexSnapshot = { overview: overview(), sessions: [] };
      const tile = await render(NowPlayingTile, 'plex-player:any');

      realtime.push('PlexSessions', [session({ state: 'paused' })]);
      await settle();

      expect(button(tile, 'Play')).toBeTruthy();
    });

    it('flashes when the player refuses', async () => {
      realtime.plexSnapshot = { overview: overview(), sessions: [session()] };
      realtime.failCommands = true;
      const tile = await render(NowPlayingTile, 'plex-player:any');

      button(tile, 'Skip forward').click();
      await settle();

      expect(tile.classList).toContain('is-error');
    });
  });

  describe('recently added tile', () => {
    it('shows the newest posters of every library, as many as fit', async () => {
      realtime.plexSnapshot = { overview: overview(), sessions: [] };

      const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');

      expect([...tile.querySelectorAll('.hd-plex-recent__title')].map((t) => t.textContent?.trim())).toEqual(['Movie 3', 'Movie 1']);
    });

    it('shows one library, and is missing when Plex no longer has it', async () => {
      realtime.plexSnapshot = { overview: overview(), sessions: [] };

      const movies = await render(RecentlyAddedTile, 'plex-library:1', 'full');
      const gone = await render(RecentlyAddedTile, 'plex-library:9');

      expect(movies.querySelectorAll('.hd-plex-recent__item').length).toBe(2);
      expect(gone.classList).toContain('is-missing');
    });
  });

  it('moves progress on while playing, never past the end', () => {
    const playing = { ...session({ offsetMs: 1000, durationMs: 5000 }), receivedAt: 0 } as LivePlexSession;

    expect(plexPosition(playing, 2000)).toBe(3000);
    expect(plexPosition(playing, 60_000)).toBe(5000);
    expect(plexPosition({ ...playing, state: 'paused' }, 2000)).toBe(1000);
  });

  it('writes times as people read them', () => {
    expect(plexTime(247_000)).toBe('4:07');
    expect(plexTime(3_909_000)).toBe('1:05:09');
  });

  it('says when something was added', () => {
    const now = new Date('2026-10-31T12:00:00').getTime();
    expect(addedOn('2026-10-31T08:00:00', now)).toBe('Today');
    expect(addedOn('2026-10-30T08:00:00', now)).toBe('Yesterday');
    expect(addedOn('2026-10-28T08:00:00', now)).toBe('3 days ago');
  });

  it('registers both kinds, following any player and every library by default', () => {
    expect(PLEX_TILES.kinds.map((k) => [k.id, k.target, (k.defaultSettings as { target: string }).target])).toEqual([
      ['plex-now-playing', 'plexPlayer', 'plex-player:any'],
      ['plex-recent', 'plexLibrary', 'plex-library:all'],
    ]);
  });
});
