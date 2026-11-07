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
import { LibraryTile } from './library-tile';
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
    // The test browser plays nothing; a tile that plays music or a theme only asks.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockReset().mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReset().mockReturnValue(undefined);
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

    describe('under a show or an album', () => {
      const child = (id: string, kind: PlexItem['kind'], title: string, index: number, change: Partial<PlexItem> = {}): PlexItem => ({
        ...item(Number(id), '1970-01-01T00:00:00Z'),
        kind,
        title,
        index,
        ...change,
      });

      // Finds `found` by a search and opens it.
      const openFound = async (found: PlexItem) => {
        prepare();
        realtime.plexSearchResults = [found];
        const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');
        const press = presser(tile);
        tile.click();
        await settle();
        const search = tile.querySelector('.hd-plex-recent__search') as HTMLInputElement;
        search.value = found.title;
        search.dispatchEvent(new Event('input'));
        await new Promise((resolve) => setTimeout(resolve, 400));
        await settle();
        return { tile, press };
      };

      const text = (tile: HTMLElement, selector: string) => tile.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

      it('opens a show to its seasons, a season to its episodes, and an episode to play', async () => {
        realtime.plexChildrenList = [child('91', 'season', 'Season 1', 1, { subtitle: '3 episodes' })];
        const { tile, press } = await openFound({ ...item(9, '1970-01-01T00:00:00Z'), kind: 'show', title: 'The Bear' });

        await press('.hd-plex-recent__card');
        expect(realtime.commands).toContainEqual(['plexChildren', 1, '9']);
        expect(text(tile, '.hd-plex-recent__section')).toBe('Seasons');
        expect([...tile.querySelectorAll('.hd-plex-recent__seasons .hd-plex-recent__card-title')].map((t) => t.textContent)).toEqual(['Season 1']);
        // A show does not play; its episodes do.
        expect(tile.querySelector('.hd-plex-recent__play')).toBeNull();

        realtime.plexChildrenList = [child('911', 'episode', 'System', 1, { durationMs: 1_680_000 }), child('912', 'episode', 'Hands', 2)];
        await press('.hd-plex-recent__seasons .hd-plex-recent__card');
        expect(realtime.commands).toContainEqual(['plexChildren', 1, '91']);
        expect(text(tile, '.hd-plex-recent__headline')).toBe('Season 1');
        expect(text(tile, '.hd-plex-recent__added')).toBe('The Bear');
        expect(text(tile, '.hd-plex-recent__section')).toBe('Episodes');
        expect([...tile.querySelectorAll('.hd-plex-recent__row')].map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['1 System 28m', '2 Hands']);

        await press('.hd-plex-recent__row', 'Hands');
        expect(text(tile, '.hd-plex-recent__headline')).toBe('Hands');
        expect(text(tile, '.hd-plex-recent__added')).toBe('The Bear › Season 1');
        await press('.hd-plex-recent__play');
        await press('.hd-plex-recent__receiver');
        // An episode chosen from its season goes on with the season's next episodes.
        expect(realtime.commands).toContainEqual(['playAlbumOnAirPlay', 1, '91', '912', 'tv']);

        // Back goes up one step at a time, then to the grid.
        await press('.hd-plex-recent__back');
        expect(text(tile, '.hd-plex-recent__headline')).toBe('Season 1');
        await press('.hd-plex-recent__back');
        expect(text(tile, '.hd-plex-recent__headline')).toBe('The Bear');
        await press('.hd-plex-recent__back');
        expect(tile.querySelector('.hd-plex-recent__pane')).not.toBeNull();
      });

      it('plays an album, and a track chosen from it with the rest of the album after it', async () => {
        realtime.plexChildrenList = [
          child('81', 'track', 'First', 1, { durationMs: 187_000 }),
          child('82', 'track', 'Second', 2, { durationMs: 200_000, subtitle: 'Guest' }),
        ];
        const { tile, press } = await openFound({ ...item(8, '1970-01-01T00:00:00Z'), kind: 'album', title: 'The Album', subtitle: 'The Artist' });

        await press('.hd-plex-recent__card');
        expect(text(tile, '.hd-plex-recent__section')).toBe('Tracks');
        expect([...tile.querySelectorAll('.hd-plex-recent__row')].map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
          '1 First 3:07',
          '2 Second Guest 3:20',
        ]);
        expect(text(tile, '.hd-plex-recent__play')).toBe('Play album on AirPlay');
        await press('.hd-plex-recent__play');
        await press('.hd-plex-recent__receiver');
        expect(realtime.commands).toContainEqual(['playOnAirPlay', 1, '8', 'tv']);

        await press('.hd-plex-recent__row', 'Second');
        expect(text(tile, '.hd-plex-recent__added')).toBe('The Album');
        expect(tile.querySelector('.hd-plex-recent__children')).toBeNull();
        await press('.hd-plex-recent__play');
        await press('.hd-plex-recent__receiver');
        expect(realtime.commands).toContainEqual(['playAlbumOnAirPlay', 1, '8', '82', 'tv']);
      });

      it('says what played and where in the album', async () => {
        prepare();
        realtime.airPlayNow = [{
          deviceId: 'tv', deviceName: 'Living room TV', accountId: 1, itemId: '82', title: 'Second', paused: false,
          audioStreamId: null, subtitleStreamId: null, offsetMs: 0, at: '2026-11-01T10:00:00Z', detail: 'The Artist — The Album · 2 of 2',
        }];
        const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');
        tile.click();
        await settle();

        expect(text(tile, '.hd-plex-recent__now-text')).toBe('SecondThe Artist — The Album · 2 of 2Playing on Living room TV');
      });

      // What the screen's speakers were told to play, oldest first; and the element that played last.
      const speakers = () => {
        const urls: string[] = [];
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
          urls.push(decodeURIComponent(new URL(this.src, 'http://x').search));
          return Promise.resolve();
        });
        const paused = vi.spyOn(HTMLMediaElement.prototype, 'pause');
        return { played: () => urls, paused, element: () => play.mock.contexts[play.mock.contexts.length - 1] as HTMLMediaElement };
      };

      it("plays a show's theme from opening it, through its seasons and episodes, until it is left", async () => {
        const { played, paused } = speakers();
        realtime.plexChildrenList = [child('91', 'season', 'Season 1', 1)];
        const { tile, press } = await openFound({ ...item(9, '1970-01-01T00:00:00Z'), kind: 'show', title: 'The Bear' });
        expect(played()).toEqual([]);

        await press('.hd-plex-recent__card');
        expect(played()).toEqual(['?account=1&item=9&theme=true']);

        // Seasons and episodes go on with it, not over from the start.
        realtime.plexChildrenList = [child('911', 'episode', 'System', 1)];
        await press('.hd-plex-recent__seasons .hd-plex-recent__card');
        await press('.hd-plex-recent__row', 'System');
        expect(text(tile, '.hd-plex-recent__headline')).toBe('System');
        expect(played().length).toBe(1);
        expect(paused).not.toHaveBeenCalled();

        // Back inside the show still plays it; the grid does not.
        await press('.hd-plex-recent__back');
        await press('.hd-plex-recent__back');
        expect(paused).not.toHaveBeenCalled();
        await press('.hd-plex-recent__back');
        expect(paused).toHaveBeenCalledTimes(1);
      });

      it("stops a show's theme once an episode actually plays, and does not start it over in the same show", async () => {
        const { played, paused } = speakers();
        realtime.plexChildrenList = [child('91', 'season', 'Season 1', 1)];
        const { press } = await openFound({ ...item(9, '1970-01-01T00:00:00Z'), kind: 'show', title: 'The Bear' });
        await press('.hd-plex-recent__card');
        expect(played()).toEqual(['?account=1&item=9&theme=true']);
        expect(paused).not.toHaveBeenCalled();

        realtime.push('AirPlayNow', [{
          deviceId: 'tv', deviceName: 'Living room TV', accountId: 1, itemId: '911', title: 'System', paused: false,
          audioStreamId: null, subtitleStreamId: null, offsetMs: 0, at: '2026-11-01T10:00:00Z', detail: null,
        }]);
        await settle();
        expect(paused).toHaveBeenCalledTimes(1);

        // Playback ends, but the theme stays quiet while the show stays open.
        realtime.push('AirPlayNow', []);
        await settle();
        expect(played().length).toBe(1);
      });

      it('plays an album in the speakers of this screen, track after track', async () => {
        const { played, paused, element } = speakers();
        realtime.plexChildrenList = [
          child('81', 'track', 'First', 1, { durationMs: 187_000 }),
          child('82', 'track', 'Second', 2, { durationMs: 200_000 }),
        ];
        const { tile, press } = await openFound({ ...item(8, '1970-01-01T00:00:00Z'), kind: 'album', title: 'The Album', subtitle: 'The Artist' });

        await press('.hd-plex-recent__card');
        await press('.hd-plex-recent__receiver', 'Play album here');
        expect(played()).toEqual(['?account=1&item=81']);
        expect(text(tile, '.hd-plex-recent__now-text')).toBe('FirstThe Artist — The Album · 1 of 2Playing here');
        expect(tile.querySelector('.hd-plex-recent__casting')?.getAttribute('aria-label')).toBe('Playing here');
        // It plays here, not on an Apple TV.
        expect(realtime.commands.some((c) => c[0] === 'playOnAirPlay' || c[0] === 'playAlbumOnAirPlay')).toBe(false);

        await press('.hd-plex-recent__now button', 'Pause');
        expect(paused).toHaveBeenCalled();
        expect(text(tile, '.hd-plex-recent__now-text')).toContain('Paused here');
        await press('.hd-plex-recent__now button', 'Resume');

        element().dispatchEvent(new Event('ended'));
        await settle();
        expect(played()).toEqual(['?account=1&item=81', '?account=1&item=81', '?account=1&item=82']);
        expect(text(tile, '.hd-plex-recent__now-text')).toBe('SecondThe Artist — The Album · 2 of 2Playing here');

        // The last track ends it.
        element().dispatchEvent(new Event('ended'));
        await settle();
        expect(tile.querySelector('.hd-plex-recent__now')).toBeNull();
        expect(tile.querySelector('.hd-plex-recent__casting')).toBeNull();
      });

      it('plays a track chosen from its album here, with the rest of the album after it', async () => {
        const { played } = speakers();
        realtime.plexChildrenList = [child('81', 'track', 'First', 1), child('82', 'track', 'Second', 2), child('83', 'track', 'Third', 3)];
        const { tile, press } = await openFound({ ...item(8, '1970-01-01T00:00:00Z'), kind: 'album', title: 'The Album', subtitle: 'The Artist' });
        await press('.hd-plex-recent__card');
        await press('.hd-plex-recent__row', 'Second');

        await press('.hd-plex-recent__receiver', 'Play here');

        expect(played()).toEqual(['?account=1&item=82']);
        expect(text(tile, '.hd-plex-recent__now-text')).toBe('SecondThe Artist — The Album · 2 of 3Playing here');
      });

      it('says so when the speakers cannot play it', async () => {
        const { element } = speakers();
        realtime.plexChildrenList = [child('81', 'track', 'First', 1)];
        const { tile, press } = await openFound({ ...item(8, '1970-01-01T00:00:00Z'), kind: 'album', title: 'The Album' });
        await press('.hd-plex-recent__card');
        await press('.hd-plex-recent__receiver', 'Play album here');

        element().dispatchEvent(new Event('error'));
        await settle();

        expect(tile.querySelector('.hd-plex-recent__now')).toBeNull();
        expect(text(tile, '.hd-plex-recent__children ~ *, .hd-plex-recent__cast .hd-plex-recent__cast-error')).toBe('Could not play First.');
      });

      describe('profiles', () => {
        const home = () => {
          realtime.plexProfileList = {
            profiles: [
              { id: '1', name: 'Martin', admin: true, protected: false },
              { id: '2', name: 'Sam', admin: false, protected: false },
              { id: '3', name: 'Kids', admin: false, protected: true },
            ],
            currentId: '1',
          };
        };

        it('names the profile in use, and switches to another with one press', async () => {
          home();
          const { tile, press } = await openFound({ ...item(5, '1970-01-01T00:00:00Z'), title: 'A Film' });
          expect(text(tile, '.hd-plex-recent__profile')).toBe('Martin');
          // The button opens the popover (the browser's own doing); its options are the home's profiles.
          expect(tile.querySelector('.hd-plex-recent__profile')?.getAttribute('popovertarget')).toBe(tile.querySelector('.hd-plex-recent__profiles')?.id);
          expect([...tile.querySelectorAll('.hd-plex-recent__profile-option')].map((o) => o.textContent?.trim())).toEqual(['Martin', 'Sam', 'Kids']);

          await press('.hd-plex-recent__profile-option', 'Sam');

          expect(realtime.commands).toContainEqual(['plexSelectProfile', 1, '2', null]);
          expect(text(tile, '.hd-plex-recent__profile')).toBe('Sam');
        });

        it('asks a protected profile for its PIN, and says when Plex does not accept it', async () => {
          home();
          const { tile, press } = await openFound({ ...item(5, '1970-01-01T00:00:00Z'), title: 'A Film' });
          await press('.hd-plex-recent__profile-option', 'Kids');
          expect(realtime.commands.some((c) => c[0] === 'plexSelectProfile')).toBe(false);

          realtime.plexProfileError = new Error('HubException: That PIN is not right.');
          (tile.querySelector('.hd-plex-recent__pin input') as HTMLInputElement).value = '0000';
          await press('.hd-plex-recent__pin button');

          expect(realtime.commands).toContainEqual(['plexSelectProfile', 1, '3', '0000']);
          expect(text(tile, '.hd-plex-recent__profiles .hd-plex-recent__cast-error')).toBe('That PIN is not right.');
          expect(text(tile, '.hd-plex-recent__profile')).toBe('Martin');
        });

        it('has no profile button for an account without a home', async () => {
          const { tile } = await openFound({ ...item(5, '1970-01-01T00:00:00Z'), title: 'A Film' });
          expect(tile.querySelector('.hd-plex-recent__profile')).toBeNull();
        });
      });

      it('is back at the same place in the covers after one is opened and left', async () => {
        const { tile, press } = await openFound({ ...item(5, '1970-01-01T00:00:00Z'), title: 'A Film' });
        const pane = () => tile.querySelector('.hd-plex-recent__pane') as HTMLElement;
        pane().scrollTop = 240;
        pane().dispatchEvent(new Event('scroll'));
        await press('.hd-plex-recent__card');
        expect(tile.querySelector('.hd-plex-recent__pane')).toBeNull();

        await press('.hd-plex-recent__back');
        await settle();

        expect(pane().scrollTop).toBe(240);
      });

      it('plays a film or an episode here, in a video over the dialog, until it is stopped', async () => {
        for (const kind of ['movie', 'episode'] as const) {
          const { tile, press } = await openFound({ ...item(7, '1970-01-01T00:00:00Z'), kind, title: 'The Film' });
          await press('.hd-plex-recent__card');
          expect(tile.querySelector('.hd-plex-recent__player')).toBeNull();

          await press('.hd-plex-recent__receiver', 'Play here');

          const video = tile.querySelector('video.hd-plex-recent__video') as HTMLVideoElement;
          expect(video.getAttribute('src')).toBe('/api/plex/video?account=1&item=7');
          video.dispatchEvent(new Event('play'));
          await press('.hd-plex-recent__player .hd-plex-recent__receiver', 'Stop');
          expect(tile.querySelector('.hd-plex-recent__player')).toBeNull();
          // Plex hears it start and stop, as a Plex client would tell it.
          const reports = realtime.commands.filter((c) => c[0] === 'plexProgress').map((c) => c.slice(1, 4));
          expect(reports.slice(-2)).toEqual([[1, '7', 'playing'], [1, '7', 'stopped']]);
          tile.remove();
        }
      });

      it('goes on with the next episode of the season when an episode played here ends', async () => {
        realtime.plexChildrenList = [child('91', 'season', 'Season 1', 1)];
        const { tile, press } = await openFound({ ...item(9, '1970-01-01T00:00:00Z'), kind: 'show', title: 'The Bear' });
        await press('.hd-plex-recent__card');
        realtime.plexChildrenList = [child('911', 'episode', 'System', 1), child('912', 'episode', 'Hands', 2)];
        await press('.hd-plex-recent__seasons .hd-plex-recent__card');
        await press('.hd-plex-recent__row', 'System');
        await press('.hd-plex-recent__receiver', 'Play here');
        const video = () => tile.querySelector('video.hd-plex-recent__video') as HTMLVideoElement;
        expect(video().getAttribute('src')).toBe('/api/plex/video?account=1&item=911');

        video().dispatchEvent(new Event('ended'));
        await settle();
        expect(video().getAttribute('src')).toBe('/api/plex/video?account=1&item=912');
        // The first counts as watched, and the last one ends the season.
        expect(realtime.commands.filter((c) => c[0] === 'plexProgress').map((c) => c.slice(1, 4))).toContainEqual([1, '911', 'stopped']);
        video().dispatchEvent(new Event('ended'));
        await settle();
        expect(tile.querySelector('.hd-plex-recent__player')).toBeNull();
      });

      it('shows what was played: a film, an episode, a season', async () => {
        realtime.plexChildrenList = [
          child('91', 'season', 'Season 1', 1, { watched: true }),
          child('92', 'season', 'Season 2', 2, { watched: false }),
        ];
        const { tile, press } = await openFound({ ...item(9, '1970-01-01T00:00:00Z'), kind: 'show', title: 'The Bear', watched: false });
        // A search result that was played says so on its card.
        expect(tile.querySelector('.hd-plex-recent__seen')).toBeNull();

        await press('.hd-plex-recent__card');
        const seasons = [...tile.querySelectorAll('.hd-plex-recent__seasons .hd-plex-recent__card')];
        expect(seasons.map((c) => !!c.querySelector('.hd-plex-recent__seen'))).toEqual([true, false]);

        realtime.plexChildrenList = [child('911', 'episode', 'System', 1, { watched: true }), child('912', 'episode', 'Hands', 2)];
        await press('.hd-plex-recent__seasons .hd-plex-recent__card');
        // The season says it was watched in full; its episodes say which were played.
        expect(text(tile, '.hd-plex-recent__watched')).toBe('Watched');
        expect([...tile.querySelectorAll('.hd-plex-recent__row')].map((r) => !!r.querySelector('[aria-label="Watched"]'))).toEqual([true, false]);

        await press('.hd-plex-recent__row', 'System');
        expect(text(tile, '.hd-plex-recent__watched')).toBe('Watched');
        await press('.hd-plex-recent__back');
        await press('.hd-plex-recent__row', 'Hands');
        expect(tile.querySelector('.hd-plex-recent__watched')).toBeNull();
      });

      it('shows a film that was played on its card and in its facts', async () => {
        prepare();
        realtime.plexSearchResults = [{ ...item(9, '1970-01-01T00:00:00Z'), title: 'Seen film', watched: true }, { ...item(10, '1970-01-01T00:00:00Z'), title: 'New film' }];
        const tile = await render(RecentlyAddedTile, 'plex-library:all', 'wide');
        tile.click();
        await settle();
        const search = tile.querySelector('.hd-plex-recent__search') as HTMLInputElement;
        search.value = 'film';
        search.dispatchEvent(new Event('input'));
        await new Promise((resolve) => setTimeout(resolve, 400));
        await settle();

        const cards = [...tile.querySelectorAll('.hd-plex-recent__card')];
        expect(cards.map((c) => !!c.querySelector('.hd-plex-recent__seen'))).toEqual([true, false]);
        (cards[0] as HTMLElement).click();
        await settle();
        expect(text(tile, '.hd-plex-recent__watched')).toBe('Watched');
      });

      it('says why what is under it cannot be loaded', async () => {
        realtime.plexChildren = async () => {
          throw new Error('An unexpected error occurred invoking PlexChildren: HubException: Could not reach Plex.');
        };
        const { tile, press } = await openFound({ ...item(9, '1970-01-01T00:00:00Z'), kind: 'show', title: 'The Bear' });

        await press('.hd-plex-recent__card');

        expect(text(tile, '.hd-plex-recent__children .hd-plex-recent__empty')).toBe('Could not reach Plex.');
      });
    });

    describe('library tile', () => {
      const film = (n: number, title: string): PlexItem => ({ ...item(n, '2026-10-30T10:00:00Z'), title, subtitle: '2020' });
      const films = Array.from({ length: 130 }, (_, n) => film(1000 + n, `Film ${String(n).padStart(3, '0')}`));
      const withCounts = () => {
        prepare();
        const base = overview();
        realtime.plexSnapshot = {
          accounts: [
            {
              ...base,
              libraries: [
                { ...base.libraries[0], count: 130, titles: base.libraries[0].recent },
                // What is newly added to a library of series is episodes; its posters are of the series themselves.
                { ...base.libraries[1], count: 2_500, recent: [{ ...item(3, '2026-10-31T10:00:00Z'), kind: 'episode', title: 'An episode' }], titles: [{ ...item(5, '2026-10-29T10:00:00Z'), kind: 'show', title: 'A series' }] },
              ],
            },
          ],
          sessions: [],
        };
        realtime.plexLibraryList = films;
      };
      const open = async (target = 'plex-library:all') => {
        const tile = await render(LibraryTile, target, 'wide');
        tile.click();
        await settle();
        return tile;
      };
      const titles = (tile: HTMLElement) => [...tile.querySelectorAll('.hd-plex-recent__pane > .hd-plex-recent__card .hd-plex-recent__card-title')].map((t) => t.textContent);

      it('names its library on the face, with how many it holds', async () => {
        withCounts();
        const one = await render(LibraryTile, 'plex-library:1', 'wide');
        const all = await render(LibraryTile, 'plex-library:all', 'wide');

        expect(one.querySelector('.hd-photo__label')?.textContent).toBe('Movies · 130');
        expect(all.querySelector('.hd-photo__label')?.textContent).toBe('Plex library · 2,630');
      });

      it('shows films, series and albums on its face, not what was newly added under them', async () => {
        withCounts();
        const series = await render(LibraryTile, 'plex-library:2', 'wide');
        const all = await render(LibraryTile, 'plex-library:all', 'wide');
        const recent = await render(RecentlyAddedTile, 'plex-library:2', 'wide');

        const captions = (tile: HTMLElement) => [...tile.querySelectorAll('.hd-plex-recent__title')].map((t) => t.textContent);
        expect(captions(series)).toEqual(['A series']);
        expect(captions(all)).toEqual(['Movie 1', 'A series']);
        // The recently-added tile still shows what is new, episodes included.
        expect(captions(recent)).toEqual(['An episode']);
      });

      it('lists everything in the library a page at a time, alphabetically, without when it was added', async () => {
        withCounts();
        const tile = await open('plex-library:1');

        expect(realtime.commands).toContainEqual(['plexLibraryItems', 1, '1', 0, 60]);
        expect(titles(tile).length).toBe(60);
        expect(titles(tile)[0]).toBe('Film 000');
        expect(tile.querySelector('.hd-plex-recent__card-added')).toBeNull();
        expect(tile.querySelector('.hd-plex-recent__badge')).toBeNull();
        expect(tile.querySelector('.hd-details__head')?.textContent).toContain('130 movies');

        // Scrolled near the end, the next page comes, and after the last nothing more is asked.
        const pane = tile.querySelector('.hd-plex-recent__pane') as HTMLElement;
        pane.dispatchEvent(new Event('scroll'));
        await settle();
        pane.dispatchEvent(new Event('scroll'));
        await settle();
        pane.dispatchEvent(new Event('scroll'));
        await settle();
        expect(titles(tile).length).toBe(130);
        expect(realtime.commands.filter((c) => c[0] === 'plexLibraryItems').map((c) => c[3])).toEqual([0, 60, 120]);
      });

      it('has a tab per library, with no "all", each listing its own', async () => {
        withCounts();
        const tile = await open();
        const press = presser(tile);

        expect([...tile.querySelectorAll('.hd-segmented button')].map((b) => b.textContent?.trim())).toEqual(['Movies', 'TV Shows']);
        expect(realtime.commands).toContainEqual(['plexLibraryItems', 1, '1', 0, 60]);

        await press('.hd-segmented button', 'TV Shows');
        expect(realtime.commands).toContainEqual(['plexLibraryItems', 1, '2', 0, 60]);
      });

      it('searches the library of the tab, and a cover found opens and plays as in the newest', async () => {
        withCounts();
        realtime.plexSearchResults = [film(9, 'Older movie')];
        const tile = await open('plex-library:1');
        const press = presser(tile);
        const search = tile.querySelector('.hd-plex-recent__search') as HTMLInputElement;

        search.value = 'ol';
        search.dispatchEvent(new Event('input'));
        await new Promise((resolve) => setTimeout(resolve, 400));
        await settle();

        expect(realtime.commands).toContainEqual(['searchPlex', 1, 'ol', '1']);
        expect(titles(tile)).toEqual(['Older movie']);
        await press('.hd-plex-recent__card');
        expect(tile.querySelector('.hd-plex-recent__play')).not.toBeNull();
      });

      it('says why a library cannot be listed', async () => {
        withCounts();
        realtime.plexLibraryItems = async () => {
          throw new Error('An unexpected error occurred invoking PlexLibraryItems: HubException: Could not reach Plex.');
        };
        const tile = await open('plex-library:1');

        expect(tile.querySelector('.hd-plex-recent__empty')?.textContent?.trim()).toBe('Could not reach Plex.');
      });

      it('lists nothing before it is opened', async () => {
        withCounts();
        await render(LibraryTile, 'plex-library:1', 'wide');

        expect(realtime.commands.some((c) => c[0] === 'plexLibraryItems')).toBe(false);
      });
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

  it('registers its kinds, following any player and every library by default', () => {
    expect(PLEX_TILES.kinds.map((k) => [k.id, k.target, (k.defaultSettings as { target: string }).target])).toEqual([
      ['plex-now-playing', 'plexPlayer', 'plex-player:any'],
      ['plex-recent', 'plexLibrary', 'plex-library:all'],
      ['plex-library', 'plexLibrary', 'plex-library:all'],
    ]);
  });
});
