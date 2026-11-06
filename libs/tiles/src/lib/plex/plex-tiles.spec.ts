import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AirPlayPlayback, PlexItem, PlexOverview, PlexSession, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { TileSize } from '@homey-dash/layout';
import { RealtimeTileData } from '../realtime-tile-data';
import { TileData } from '../tile-data';
import { NowPlayingTile } from './now-playing-tile';
import { PLEX_TILES } from './plex-tiles';
import { LivePlexSession, PlexData, plexPosition, plexTime } from './plex-data';
import { addedOn, RecentlyAddedTile, runtime } from './recently-added-tile';

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
  accountId: 1,
  ...change,
});

const item = (n: number, addedAt: string): PlexItem => ({
  id: `${n}`,
  kind: 'movie',
  title: `Movie ${n}`,
  subtitle: null,
  image: `/library/metadata/${n}/thumb`,
  addedAt,
  summary: n === 3 ? 'A long summary.' : null,
  year: n === 3 ? 2024 : null,
  durationMs: n === 3 ? 9_960_000 : null,
  rating: n === 3 ? 8.4 : null,
  contentRating: n === 3 ? 'PG-13' : null,
  genres: n === 3 ? ['Drama', 'Adventure'] : [],
  art: `/library/metadata/${n}/art`,
});

const overview = (change: Partial<PlexOverview> = {}): PlexOverview => ({
  accountId: 1,
  accountName: 'Home',
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

  async function render(component: Type<unknown>, target: string | null, size: TileSize = 'wide', account?: number) {
    TestBed.inject(PlexData); // Connects, so pushes reach it.
    await settle();
    const fixture = TestBed.createComponent(component);
    fixture.componentRef.setInput('settings', { target, account });
    fixture.componentRef.setInput('size', size);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  describe('now playing tile', () => {
    it('shows what plays over its artwork, and pauses it from its button', async () => {
      realtime.plexSnapshot = { accounts: [overview()], sessions: [session()] };
      const tile = await render(NowPlayingTile, 'plex-player:any');

      expect(tile.classList).toContain('has-art');
      expect(tile.querySelector('.hd-plex__title')?.textContent?.trim()).toBe('Dune: Part Two');
      expect(tile.querySelector('img')?.getAttribute('src')).toContain(encodeURIComponent('/library/metadata/101/art'));
      button(tile, 'Pause').click();
      await settle();

      expect(realtime.commands).toContainEqual(['controlPlex', 1, 'tv', 'pause']);
    });

    it('follows only its own player', async () => {
      realtime.plexSnapshot = { accounts: [overview()], sessions: [session({ playerId: 'ipad', playerName: 'iPad' })] };

      const tile = await render(NowPlayingTile, 'plex-player:tv');

      expect(tile.classList).not.toContain('has-art');
      expect(tile.textContent).toContain('Living room TV');
      expect(tile.textContent).toContain('Nothing playing');
    });

    it('says when Plex is not set up', async () => {
      realtime.plexSnapshot = { accounts: [], sessions: [] };

      const tile = await render(NowPlayingTile, 'plex-player:any');

      expect(tile.textContent).toContain('Plex is not set up');
      expect(tile.classList).toContain('is-unavailable');
    });

    it('starts showing a session as soon as it is pushed', async () => {
      realtime.plexSnapshot = { accounts: [overview()], sessions: [] };
      const tile = await render(NowPlayingTile, 'plex-player:any');

      realtime.push('PlexSessions', [session({ state: 'paused' })]);
      await settle();

      expect(button(tile, 'Play')).toBeTruthy();
    });

    it('follows the players of its own account, with pictures from its server', async () => {
      const attic = overview({ accountId: 2, accountName: 'Attic', players: [{ id: 'tv', name: 'Attic TV' }] });
      realtime.plexSnapshot = {
        accounts: [overview(), attic],
        sessions: [session(), session({ id: '2', title: 'Arrival', accountId: 2, playerName: 'Attic TV' })],
      };

      const tile = await render(NowPlayingTile, 'plex-player:tv', 'wide', 2);
      button(tile, 'Pause').click();
      await settle();

      expect(tile.querySelector('.hd-plex__title')?.textContent?.trim()).toBe('Arrival');
      expect(tile.querySelector('img')?.getAttribute('src')).toContain('account=2');
      expect(realtime.commands).toContainEqual(['controlPlex', 2, 'tv', 'pause']);
    });

    it('flashes when the player refuses', async () => {
      realtime.plexSnapshot = { accounts: [overview()], sessions: [session()] };
      realtime.failCommands = true;
      const tile = await render(NowPlayingTile, 'plex-player:any');

      button(tile, 'Skip forward').click();
      await settle();

      expect(tile.classList).toContain('is-error');
    });
  });

  describe('recently added tile', () => {
    it('shows the newest posters of every library, as many as fit', async () => {
      realtime.plexSnapshot = { accounts: [overview()], sessions: [] };

      const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');

      expect([...tile.querySelectorAll('.hd-plex-recent__title')].map((t) => t.textContent?.trim())).toEqual(['Movie 3', 'Movie 1']);
    });

    it('shows one library, and is missing when Plex no longer has it', async () => {
      realtime.plexSnapshot = { accounts: [overview()], sessions: [] };

      const movies = await render(RecentlyAddedTile, 'plex-library:1', 'full');
      const gone = await render(RecentlyAddedTile, 'plex-library:9');

      expect(movies.querySelectorAll('.hd-plex-recent__item').length).toBe(2);
      expect(gone.classList).toContain('is-missing');
    });

    it('opens a full-screen grid with a tab per library, filtering by tab', async () => {
      HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.open = true;
      };
      realtime.plexSnapshot = { accounts: [overview()], sessions: [] };
      const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');
      const tileCard = () => tile.querySelectorAll('.hd-plex-recent__card-title');
      const dialog = tile.querySelector('dialog') as HTMLDialogElement;

      tile.click();
      await settle();

      expect(dialog.classList).toContain('hd-details--screen');
      expect([...tileCard()].map((t) => t.textContent?.trim())).toEqual(['Movie 3', 'Movie 1', 'Movie 2']);
      const tabs = [...tile.querySelectorAll('.hd-details .hd-segmented button')];
      expect(tabs.map((b) => b.textContent?.trim())).toEqual(['All', 'Movies', 'TV Shows']);
      (tabs[2] as HTMLElement).click();
      await settle();

      expect([...tileCard()].map((t) => t.textContent?.trim())).toEqual(['Movie 3']);
    });

    it('opens the details of a cover, and goes back to the covers', async () => {
      HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.open = true;
      };
      realtime.plexSnapshot = { accounts: [overview()], sessions: [] };
      const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');

      tile.click();
      await settle();
      (tile.querySelector('.hd-plex-recent__card') as HTMLElement).click();
      await settle();

      const text = (selector: string) => tile.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
      expect(text('.hd-plex-recent__headline')).toBe('Movie 3');
      expect([...tile.querySelectorAll('.hd-plex-recent__meta > span')].map((m) => m.textContent?.trim())).toEqual(['8.4', '2024', '2h 46m', 'PG-13']);
      expect([...tile.querySelectorAll('.hd-plex-recent__genres span')].map((g) => g.textContent?.trim())).toEqual(['Drama', 'Adventure']);
      expect(text('.hd-plex-recent__summary')).toBe('A long summary.');
      expect(tile.querySelector('.hd-plex-recent__pane')).toBeNull();
      (button(tile, 'Back to the covers')).click();
      await settle();

      expect(tile.querySelector('.hd-plex-recent__pane')).not.toBeNull();
    });

    const playback = (change: Partial<AirPlayPlayback> = {}): AirPlayPlayback => ({
      deviceId: 'tv',
      deviceName: 'Living room TV',
      accountId: 1,
      itemId: '3',
      title: 'Movie 3',
      paused: false,
      audioStreamId: null,
      subtitleStreamId: null,
      offsetMs: 0,
      at: '2026-11-01T10:00:00Z',
      ...change,
    });

    const prepare = () => {
      HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.open = true;
      };
      realtime.plexSnapshot = { accounts: [overview()], sessions: [] };
      realtime.airPlay = {
        available: true,
        devices: [
          { id: 'tv', name: 'Living room TV', kind: 'tv', paired: true },
          { id: 'kitchen', name: 'Kitchen speaker', kind: 'speaker', paired: true },
        ],
      };
    };

    const presser = (tile: HTMLElement) => async (selector: string, text?: string) => {
      ([...tile.querySelectorAll(selector)].find((b) => !text || b.textContent?.includes(text)) as HTMLElement).click();
      await settle();
    };

    it('plays a cover on an Apple TV through AirPlay, and shows it from what the server says plays', async () => {
      prepare();
      const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');
      const press = presser(tile);

      tile.click();
      await settle();
      await press('.hd-plex-recent__card');
      await press('.hd-plex-recent__play');

      expect([...tile.querySelectorAll('.hd-plex-recent__receiver')].map((b) => b.textContent?.trim())).toEqual(['Living room TV']);
      await press('.hd-plex-recent__receiver');
      expect(realtime.commands).toContainEqual(['playOnAirPlay', 1, '3', 'tv']);

      // The server tells every screen, this one included; until then nothing claims to play.
      expect(tile.querySelector('.hd-plex-recent__now')).toBeNull();
      realtime.push('AirPlayNow', [playback()]);
      await settle();
      expect(tile.querySelector('.hd-plex-recent__now')?.textContent).toContain('Playing on Living room TV');
      // The tile itself shows that something plays, and when it is paused.
      expect(tile.querySelector('.hd-plex-recent__casting')?.getAttribute('aria-label')).toBe('Playing on Living room TV');
      // The controls stay on show back in the grid, not only on the cover that was played.
      await press('.hd-plex-recent__back');
      expect(tile.querySelector('.hd-plex-recent__now')).not.toBeNull();

      await press('.hd-plex-recent__now button', 'Pause');
      expect(realtime.commands).toContainEqual(['setAirPlayPaused', 'tv', true]);
      realtime.push('AirPlayNow', [playback({ paused: true })]);
      await settle();
      expect(tile.querySelector('.hd-plex-recent__now')?.textContent).toContain('Paused on Living room TV');
      expect(tile.querySelector('.hd-plex-recent__casting')?.getAttribute('aria-label')).toBe('Paused on Living room TV');

      await press('.hd-plex-recent__now button', 'Resume');
      expect(realtime.commands).toContainEqual(['setAirPlayPaused', 'tv', false]);
      await press('.hd-plex-recent__now button', 'Stop');
      expect(realtime.commands).toContainEqual(['stopAirPlay', 'tv']);
      realtime.push('AirPlayNow', []);
      await settle();
      expect(tile.querySelector('.hd-plex-recent__now')).toBeNull();
      expect(tile.querySelector('.hd-plex-recent__casting')).toBeNull();
    });

    it('shows what another screen started, and its controls work from here', async () => {
      prepare();
      realtime.airPlayNow = [playback()];
      const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');
      const press = presser(tile);

      expect(tile.querySelector('.hd-plex-recent__casting')?.getAttribute('aria-label')).toBe('Playing on Living room TV');
      tile.click();
      await settle();
      expect(tile.querySelector('.hd-plex-recent__now strong')?.textContent).toBe('Movie 3');
      await press('.hd-plex-recent__now button', 'Stop');
      expect(realtime.commands).toContainEqual(['stopAirPlay', 'tv']);
    });

    it('ignores what plays for another Plex account', async () => {
      prepare();
      realtime.airPlayNow = [playback({ accountId: 2 })];
      const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');

      expect(tile.querySelector('.hd-plex-recent__casting')).toBeNull();
    });

    it('chooses the audio and subtitle track of what plays', async () => {
      prepare();
      realtime.airPlayNow = [playback()];
      const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');
      tile.click();
      await settle();

      const [audio, subtitles] = [...tile.querySelectorAll('.hd-plex-recent__track select')] as HTMLSelectElement[];
      expect([...audio.options].map((o) => o.textContent)).toEqual(['English (AC3 5.1)', 'Nederlands (AAC Stereo)']);
      // The default track is the one Plex plays unless told otherwise.
      expect(audio.value).toBe('1');
      expect([...subtitles.options].map((o) => o.textContent)).toEqual(['Off', 'English (SRT)']);
      expect(subtitles.value).toBe('');

      audio.value = '2';
      audio.dispatchEvent(new Event('change'));
      await settle();
      expect(realtime.commands).toContainEqual(['changeAirPlayTracks', 'tv', '2', null]);

      realtime.push('AirPlayNow', [playback({ audioStreamId: '2' })]);
      await settle();
      subtitles.value = '11';
      subtitles.dispatchEvent(new Event('change'));
      await settle();
      expect(realtime.commands).toContainEqual(['changeAirPlayTracks', 'tv', '2', '11']);
    });

    it('searches the whole library, and what it finds opens like a cover', async () => {
      prepare();
      realtime.plexSearchResults = [{ ...item(9, '1970-01-01T00:00:00Z'), title: 'Older movie', year: 2001 }];
      const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');
      const press = presser(tile);
      tile.click();
      await settle();

      const search = tile.querySelector('.hd-plex-recent__search') as HTMLInputElement;
      search.value = 'ol';
      search.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, 400));
      await settle();

      expect(realtime.commands).toContainEqual(['searchPlex', 1, 'ol', null]);
      const cards = [...tile.querySelectorAll('.hd-plex-recent__card')];
      expect(cards.map((c) => c.querySelector('.hd-plex-recent__card-title')?.textContent)).toEqual(['Older movie']);
      // A search result with no date says nothing about when it was added.
      expect(cards[0].querySelector('.hd-plex-recent__card-added')).toBeNull();
      await press('.hd-plex-recent__card');
      expect(tile.querySelector('.hd-plex-recent__play')).not.toBeNull();

      // Clearing the search brings the newest back.
      await press('.hd-plex-recent__back');
      const again = tile.querySelector('.hd-plex-recent__search') as HTMLInputElement;
      again.value = '';
      again.dispatchEvent(new Event('input'));
      await settle();
      expect(tile.querySelectorAll('.hd-plex-recent__card').length).toBe(3);
    });

    it('says so when a search finds nothing, and does not search for one letter', async () => {
      prepare();
      realtime.plexSearchResults = [];
      const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');
      tile.click();
      await settle();
      const search = tile.querySelector('.hd-plex-recent__search') as HTMLInputElement;

      search.value = 'z';
      search.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(realtime.commands.some((c) => c[0] === 'searchPlex')).toBe(false);

      search.value = 'zzz';
      search.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, 400));
      await settle();
      expect(tile.querySelector('.hd-plex-recent__empty')?.textContent).toContain('Nothing found for “zzz”');
    });

    it('says so when AirPlay is not set up', async () => {
      HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.open = true;
      };
      realtime.plexSnapshot = { accounts: [overview()], sessions: [] };
      realtime.airPlay = { available: false, devices: [] };
      const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');

      tile.click();
      await settle();
      (tile.querySelector('.hd-plex-recent__card') as HTMLElement).click();
      await settle();
      (tile.querySelector('.hd-plex-recent__play') as HTMLElement).click();
      await settle();

      expect(tile.querySelector('.hd-plex-recent__cast-error')?.textContent).toContain('not set up');
    });
  });

  it('says how long something runs', () => {
    expect([runtime(9_960_000), runtime(1_980_000), runtime(7_200_000)]).toEqual(['2h 46m', '33m', '2h']);
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
