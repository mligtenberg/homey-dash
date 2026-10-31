import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HomeySnapshot, Realtime, ScreenView, Tile } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { cellSize } from '@homey-dash/layout';
import { CORE_TILES, provideTileModules, RealtimeTileData, TileData } from '@homey-dash/tiles';
import { App, IDLE_MS } from './app';

const hallway = { id: 'd1', name: 'Hallway', dashboardId: null, otherDashboardIds: [] };
const dashboard = (id: string, name: string, version = 1, rows = 4) => ({ id, name, version, layout: { rows, sections: [] } });
const published = (version: number): ScreenView => ({
  display: { ...hallway, dashboardId: 'k1' },
  dashboards: [dashboard('k1', 'Kitchen', version)],
});
const several: ScreenView = {
  display: { ...hallway, dashboardId: 'k1', otherDashboardIds: ['g1', 'c1'] },
  dashboards: [dashboard('k1', 'Kitchen'), dashboard('g1', 'Garden', 3, 6), dashboard('c1', 'Cinema')],
};

describe('App', () => {
  let realtime: FakeRealtime;

  beforeEach(() => {
    localStorage.clear();
    realtime = new FakeRealtime();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTileModules(CORE_TILES),
        { provide: Realtime, useValue: realtime },
        { provide: TileData, useExisting: RealtimeTileData },
      ],
    });
  });

  async function start(screen: ScreenView | null) {
    realtime.screen = screen;
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const stable = () => TestBed.inject(ApplicationRef).whenStable();

  it('joins with one screen id that it keeps across loads', async () => {
    await start(null);
    const screen = localStorage.getItem('homeydash.screen');
    TestBed.createComponent(App);

    expect(screen).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(realtime.joined).toEqual([screen, screen]);
  });

  it('runs setup on a screen that is not a display', async () => {
    const root = await start(null);
    TestBed.inject(HttpTestingController).expectOne('/api/displays').flush([{ id: 'd1', name: 'Kitchen wall', dashboardId: null }]);
    await stable();

    expect(root.querySelector('h1')?.textContent).toBe('Set up this screen');
    expect(root.querySelector('li .name')?.textContent).toBe('Kitchen wall');
  });

  it('waits when no dashboard is assigned', async () => {
    const root = await start({ display: hallway, dashboards: [] });

    expect(root.querySelector('h1')?.textContent).toBe('Hallway');
    expect(root.querySelector('.hd-pill')?.textContent).toBe('Waiting for a dashboard');
    expect(realtime.shown).toEqual([{}]);
  });

  it('switches to a newly published version and reports it once it is on screen', async () => {
    const onScreen: boolean[] = [];
    realtime.onShowing = () => onScreen.push(document.querySelector('hd-dashboard-view') !== null);
    await start({ display: hallway, dashboards: [] });

    realtime.push('Screen', published(2));
    await stable();

    expect(realtime.shown).toEqual([{}, { k1: 2 }]);
    expect(onScreen).toEqual([false, true]);
  });

  it('reports what it shows again after a reconnect', async () => {
    await start(published(1));

    realtime.connected.set(false);
    realtime.reconnect();
    await stable();

    expect(realtime.shown).toEqual([{ k1: 1 }, { k1: 1 }]);
  });

  it('shows one dashboard without a tape', async () => {
    const root = await start(published(1));

    expect(root.querySelector('.hd-tape')).toBeNull();
    expect(root.querySelector('hd-dashboard-view')).not.toBeNull();
  });

  describe('with several dashboards', () => {
    const tape = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.hd-tape__item')];
    const toggle = (root: HTMLElement) => root.querySelector('.hd-tape__toggle') as HTMLButtonElement;
    // Opens the tape when it is collapsed, as picking a dashboard collapses it.
    const currentName = async (root: HTMLElement) => {
      if (toggle(root).getAttribute('aria-expanded') === 'false') {
        toggle(root).click();
        await stable();
      }
      return root.querySelector('[aria-current="page"]')?.textContent?.trim();
    };
    const startOpen = async (screen: ScreenView) => {
      localStorage.setItem('homeydash.tape', 'open');
      return start(screen);
    };

    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => vi.useRealTimers());

    it('offers them on a tape, main first, and reports the version of each', async () => {
      const root = await startOpen(several);

      expect(tape(root).map((b) => b.textContent?.trim())).toEqual(['Kitchen', 'Garden', 'Cinema']);
      expect(await currentName(root)).toBe('Kitchen');
      expect(realtime.shown).toEqual([{ k1: 1, g1: 3, c1: 1 }]);
    });

    it('switches to the one pressed, sized to its rows, and collapses the tape', async () => {
      const root = await startOpen(several);

      tape(root)[1].click();
      await stable();

      expect(tape(root)).toEqual([]);
      expect(localStorage.getItem('homeydash.tape')).toBeNull();
      expect(await currentName(root)).toBe('Garden');
      expect(parseFloat(root.style.getPropertyValue('--cell'))).toBeCloseTo(cellSize(window.innerHeight, 6));
    });

    it('returns to the main one after a while untouched, but not while it is used', async () => {
      const root = await startOpen(several);
      tape(root)[2].click();
      await stable();

      vi.advanceTimersByTime(IDLE_MS - 1);
      root.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(IDLE_MS - 1);
      await stable();
      expect(await currentName(root)).toBe('Cinema');

      vi.advanceTimersByTime(1);
      await stable();
      expect(await currentName(root)).toBe('Kitchen');
    });

    it('starts collapsed to one button, and remembers opening it on this screen', async () => {
      const root = await start(several);
      expect(tape(root)).toEqual([]);
      expect(toggle(root).getAttribute('aria-expanded')).toBe('false');
      expect(root.querySelector('hd-dashboard-view')).not.toBeNull();

      toggle(root).click();
      await stable();
      expect(tape(root).length).toBe(3);

      const again = TestBed.createComponent(App);
      await again.whenStable();
      expect(tape(again.nativeElement).length).toBe(3);

      toggle(root).click();
      await stable();
      expect(tape(root)).toEqual([]);
      expect(localStorage.getItem('homeydash.tape')).toBeNull();
    });

    it('returns to the main one when the one shown is no longer offered', async () => {
      const root = await startOpen(several);
      tape(root)[1].click();
      await stable();

      realtime.push('Screen', { ...several, dashboards: [several.dashboards[0], several.dashboards[2]] });
      await stable();

      expect(await currentName(root)).toBe('Kitchen');
    });
  });

  it('returns to setup when another screen takes the display over', async () => {
    const root = await start(published(1));

    realtime.push('Screen', null);
    await stable();

    expect(root.querySelector('h1')?.textContent).toBe('Set up this screen');
  });

  it('keeps the dashboard and shows reconnecting when HomeyDash cannot be reached', async () => {
    const root = await start(published(1));

    realtime.connected.set(false);
    await stable();

    expect(root.classList).toContain('is-connection-lost');
    expect(root.querySelector('hd-dashboard-view')).not.toBeNull();
    expect(root.querySelector('.hd-reconnecting')).not.toBeNull();
  });

  describe('with two Homeys', () => {
    const homey = (accountId: number): HomeySnapshot => ({
      ...realtime.homeySnapshot[0],
      accountId,
      accountName: `Homey ${accountId}`,
      status: { ...realtime.homeySnapshot[0].status, accountId },
    });
    const lamp = (id: string, column: number, account?: number): Tile => ({
      id,
      kind: 'device',
      size: 'small',
      position: { column, row: 0 },
      settings: account ? { target: 'lamp', account } : { target: 'lamp' },
    });
    const withTiles = (...tiles: Tile[]): ScreenView => ({
      display: { ...hallway, dashboardId: 'k1' },
      dashboards: [{ ...dashboard('k1', 'Kitchen'), layout: { rows: 4, sections: [{ id: 's1', title: '', tiles }] } }],
    });
    const lost = (accountId: number) =>
      realtime.push('HomeyStatus', { accountId, connection: 'disconnected', lastError: 'timeout', since: '', fake: false });

    beforeEach(() => (realtime.homeySnapshot = [homey(1), homey(2)]));

    it("locks just the tiles of a Homey HomeyDash can't reach, and shows reconnecting", async () => {
      const root = await start(withTiles(lamp('t1', 0), lamp('t2', 1, 2)));

      lost(2);
      await stable();

      const hosts = root.querySelectorAll('hd-tile-host');
      expect(root.classList).not.toContain('is-connection-lost');
      expect(hosts[0].classList).not.toContain('is-homey-lost');
      expect(hosts[1].classList).toContain('is-homey-lost');
      expect(root.querySelector('.hd-reconnecting')).not.toBeNull();
    });

    it('shows no reconnecting for a lost Homey the dashboard has no tiles of', async () => {
      const root = await start(withTiles(lamp('t1', 0)));

      lost(2);
      await stable();

      expect(root.querySelector('hd-tile-host')?.classList).not.toContain('is-homey-lost');
      expect(root.querySelector('.hd-reconnecting')).toBeNull();
    });
  });
});
