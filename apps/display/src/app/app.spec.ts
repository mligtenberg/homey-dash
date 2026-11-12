import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Condition, HomeySnapshot, LockWidget, PhotoSet, Realtime, ScreenView, Tile } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { fittedCellSize } from '@homey-dash/layout';
import { CORE_TILES, provideTileModules, RealtimeRuleAnswers, RealtimeTileData, RuleAnswers, TileData } from '@homey-dash/tiles';
import { App, IDLE_MS, SETTINGS_TAPS, SETTINGS_TAPS_MS, TOUCH_REPORT_MS } from './app';
import { BRIGHTNESS_MS, LightMeter } from './light-meter';

const homeToWork = {
  name: 'Home to work',
  origin: { name: 'Home', latitude: 52.089, longitude: 5.11 },
  destination: { name: 'Work', latitude: 52.379, longitude: 4.9 },
};
const hallway = { id: 'd1', name: 'Hallway', dashboardIds: [], idleRules: [], lockWidgets: [] };
const dashboard = (id: string, name: string, version = 1, rows = 4) => ({ id, name, version, layout: { rows, sections: [] } });
const published = (version: number): ScreenView => ({
  display: { ...hallway, dashboardIds: ['k1'] },
  dashboards: [dashboard('k1', 'Kitchen', version)],
});
const several: ScreenView = {
  display: { ...hallway, dashboardIds: ['k1', 'g1', 'c1'] },
  dashboards: [dashboard('k1', 'Kitchen'), dashboard('g1', 'Garden', 3, 6), dashboard('c1', 'Cinema')],
};

// jsdom has no modal dialogs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

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
        { provide: RuleAnswers, useExisting: RealtimeRuleAnswers },
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
    await stable();

    expect(screen).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(realtime.joined).toEqual([screen, screen]);
  });

  it('runs setup on a screen that is not a display', async () => {
    const root = await start(null);
    TestBed.inject(HttpTestingController).expectOne('/api/displays').flush([{ id: 'd1', name: 'Kitchen wall', dashboardIds: [] }]);
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

  it('tells HomeyDash what the screen is when it connects, and again after a reconnect', async () => {
    await start(published(1));

    expect(realtime.detailsReported.length).toBe(1);
    expect(realtime.detailsReported[0]).toMatchObject({ viewportWidth: window.innerWidth, fully: null });

    realtime.connected.set(false);
    realtime.reconnect();
    await stable();

    expect(realtime.detailsReported.length).toBe(2);
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

    it('offers them on a tape, starts on the first, and reports the version of each', async () => {
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
      expect(parseFloat(root.style.getPropertyValue('--cell'))).toBeCloseTo(
        // The tape's 68px gutter is not room for sections, and a dashboard with none has nothing to shrink for.
        fittedCellSize(window.innerWidth - 68, window.innerHeight, 6, 0),
      );
    });

    it('collapses the tape when a press lands outside it, but not on it', async () => {
      const root = await startOpen(several);

      tape(root)[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await stable();
      expect(tape(root).length).toBe(3);

      root.querySelector('hd-dashboard-view')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await stable();
      expect(tape(root)).toEqual([]);
      expect(localStorage.getItem('homeydash.tape')).toBeNull();
    });

    it('stays on the one picked once left alone, when no idle rule holds', async () => {
      const root = await startOpen(several);
      tape(root)[2].click();
      await stable();

      vi.advanceTimersByTime(IDLE_MS);
      await stable();
      expect(await currentName(root)).toBe('Cinema');
    });

    describe('with idle rules', () => {
      // Each rule names its dashboard as its one condition's signal, so a test can say which hold.
      const rule = (id: string) => ({ dashboardId: id, rule: { match: 'all' as const, conditions: [{ signal: id, operator: 'isTrue' as const }] } });
      const ruled: ScreenView = { ...several, display: { ...several.display, idleRules: [rule('c1'), rule('g1')] } };
      let holding: Record<string, boolean>;
      const hold = async (next: Record<string, boolean>) => {
        holding = next;
        realtime.answer((r) => holding[(r.conditions[0] as Condition).signal] ?? false);
        await stable();
      };

      beforeEach(() => {
        holding = {};
        realtime.answerRule = (r) => holding[(r.conditions[0] as Condition).signal] ?? false;
      });

      it('shows the first dashboard whose rule holds, and follows them while left alone', async () => {
        holding = { g1: true };
        const root = await startOpen(ruled);
        expect(await currentName(root)).toBe('Garden');

        await hold({ g1: true, c1: true });
        expect(await currentName(root)).toBe('Cinema');
      });

      it('starts on the first when none holds, and stays where it is when they stop holding', async () => {
        const root = await startOpen(ruled);
        expect(await currentName(root)).toBe('Kitchen');

        await hold({ g1: true });
        await hold({});
        expect(await currentName(root)).toBe('Garden');
      });

      it('stays where it is while used, and follows the rules again once left alone', async () => {
        const root = await startOpen(ruled);
        tape(root)[1].click();
        await stable();

        await hold({ c1: true });
        expect(await currentName(root)).toBe('Garden');

        vi.advanceTimersByTime(IDLE_MS);
        await stable();
        expect(await currentName(root)).toBe('Cinema');
      });

      it('stays on what it showed when touched, even when the rules change', async () => {
        holding = { c1: true };
        const root = await startOpen(ruled);
        root.dispatchEvent(new Event('pointerdown'));

        await hold({});
        expect(await currentName(root)).toBe('Cinema');
      });

      describe('playing a photo set', () => {
        const summer = (photos: number): PhotoSet => ({
          id: 's1', name: 'Summer', target: 'photo-set:s1', accountId: 1, accountName: 'Immich', albumId: 'a1',
          albumName: 'Summer', selection: null, syncedAt: null, skippedVideos: 0, syncError: null, syncing: false, dashboards: [], excluded: [], lockedOwners: [],
          photos: Array.from({ length: photos }, (_, i) => ({ id: `p${i}`, takenAt: null, place: null, faces: null })),
        });
        // Its rule's signal is "s1", so `hold({ s1: true })` plays it.
        const plays = (returnDashboardId: string | null = null): ScreenView => ({
          ...several,
          display: {
            ...several.display,
            idleRules: [{ ...rule('s1'), dashboardId: null, photoSetId: 's1', returnDashboardId }, rule('c1')],
          },
        });
        const slideshow = (root: HTMLElement) => root.querySelector<HTMLElement>('.slideshow');

        beforeEach(() => (realtime.photoSetList = [summer(3)]));

        it('plays it full screen over the dashboard, and a touch goes back to the one shown before', async () => {
          holding = { s1: true };
          const root = await startOpen(plays());
          expect(slideshow(root)?.querySelector('.hd-photo__img')).not.toBeNull();

          root.dispatchEvent(new Event('pointerdown'));
          slideshow(root)!.click();
          await stable();
          expect(slideshow(root)).toBeNull();
          expect(await currentName(root)).toBe('Kitchen');
        });

        it('goes back to the dashboard its rule names', async () => {
          holding = { s1: true };
          const root = await startOpen(plays('g1'));

          slideshow(root)!.click();
          await stable();
          expect(await currentName(root)).toBe('Garden');
        });

        it('plays again once left alone, and stops for a dashboard whose rule holds before it', async () => {
          holding = { s1: true };
          const root = await startOpen(plays());
          slideshow(root)!.click();
          await stable();

          vi.advanceTimersByTime(IDLE_MS);
          await stable();
          expect(slideshow(root)).not.toBeNull();

          const first: ScreenView = { ...plays(), display: { ...plays().display, idleRules: [rule('c1'), ...plays().display.idleRules] } };
          realtime.push('Screen', first);
          await hold({ s1: true, c1: true });
          expect(slideshow(root)).toBeNull();
          expect(await currentName(root)).toBe('Cinema');
        });

        it('passes over a set without photos', async () => {
          realtime.photoSetList = [summer(0)];
          holding = { s1: true, c1: true };
          const root = await startOpen(plays());

          expect(slideshow(root)).toBeNull();
          expect(await currentName(root)).toBe('Cinema');
        });
      });

      describe('filling with a colour', () => {
        // Its rule's signal is "night", so `hold({ night: true })` fills the screen.
        const fills = (returnDashboardId: string | null = null): ScreenView => ({
          ...several,
          display: {
            ...several.display,
            idleRules: [{ ...rule('night'), dashboardId: null, color: '#102030', returnDashboardId }, rule('c1')],
          },
        });
        const fill = (root: HTMLElement) => root.querySelector<HTMLElement>('.fill');

        it('fills the screen over the dashboard, and a touch goes back to the one shown before', async () => {
          holding = { night: true };
          const root = await startOpen(fills());
          expect(fill(root)?.style.background).toBe('rgb(16, 32, 48)');

          root.dispatchEvent(new Event('pointerdown'));
          fill(root)!.click();
          await stable();
          expect(fill(root)).toBeNull();
          expect(await currentName(root)).toBe('Kitchen');
        });

        it('goes back to the dashboard its rule names', async () => {
          holding = { night: true };
          const root = await startOpen(fills('g1'));

          fill(root)!.click();
          await stable();
          expect(await currentName(root)).toBe('Garden');
        });

        it('shows the lock screen widgets over it, until a touch', async () => {
          const temperature = { id: 'measure_temperature', title: 'Temperature', type: 'number', value: 20.14, units: '°C' };
          realtime.homeySnapshot = [{
            ...realtime.homeySnapshot[0],
            weather: { temperature: 13.4, state: 'Rain', humidity: 0.8, city: 'Utrecht' },
            devices: [{ id: 'th', name: 'Thermostat', class: 'thermostat', available: true, capabilities: { measure_temperature: temperature } } as never],
          }];
          const lockWidgets: LockWidget[] = [
            { kind: 'clock', spot: 'center' },
            { kind: 'weather', spot: 'top-right' },
            { kind: 'value', spot: 'bottom-left', signal: 'homey:1:capability:th:measure_temperature' },
            { kind: 'value', spot: 'bottom-left', signal: 'homey:1:capability:gone:onoff' },
            { kind: 'traffic', spot: 'top-left', route: homeToWork },
            { kind: 'traffic', spot: 'top-left', route: { ...homeToWork, destination: { name: 'Elsewhere', latitude: 1, longitude: 1 } } },
            { kind: 'traffic', spot: 'top-left' },
          ];
          realtime.trafficList = [{
            routeKey: '52.089,5.110>52.379,4.900', status: 'connected', error: null, travelSeconds: 1500, usualSeconds: 1080, delaySeconds: 420,
            distanceMeters: 21_400, arrival: '2026-11-08T17:55:00+01:00', updatedAt: '2026-11-08T17:30:00+01:00',
          }];
          holding = { night: true };
          const root = await startOpen({ ...fills(), display: { ...fills().display, lockWidgets } });

          expect(root.querySelector('.spot--center .clock__time')?.textContent).toMatch(/\d/);
          expect(root.querySelector('.spot--top-right .weather')?.textContent).toContain('13°');
          expect(root.querySelector('.spot--top-right .weather')?.textContent).toContain('Rain');
          // Traffic shows the time and delay, but not for a route nobody asked TomTom about, nor before a route is chosen.
          expect([...root.querySelectorAll('.spot--top-left .traffic')].map((t) => t.textContent?.replace(/\s+/g, ' ').trim()))
            .toEqual(['25 minHome to work · +7 min']);
          expect(root.querySelector('.spot--top-left .traffic')?.getAttribute('data-delay')).toBe('heavy');
          // A device that is gone shows nothing.
          expect([...root.querySelectorAll('.spot--bottom-left .value')].map((v) => v.textContent?.replace(/\s+/g, ' ').trim()))
            .toEqual(['20.1°CThermostat · Temperature']);

          fill(root)!.click();
          await stable();
          expect(root.querySelector('hd-lock-screen')).toBeNull();
        });

        it('leaves out the widgets that are hidden, or whose rule does not hold, and follows the rule', async () => {
          const when = (signal: string) => ({ match: 'all' as const, conditions: [{ signal, operator: 'isTrue' as const }] });
          const lockWidgets: LockWidget[] = [
            { kind: 'clock', spot: 'center' },
            { kind: 'clock', spot: 'top-left', hidden: true },
            { kind: 'clock', spot: 'top-right', rule: when('weekend') },
            { kind: 'clock', spot: 'bottom-left', rule: when('weekday') },
          ];
          holding = { night: true, weekend: true };
          const root = await startOpen({ ...fills(), display: { ...fills().display, lockWidgets } });
          const spots = () => [...root.querySelectorAll('hd-lock-screen .clock')].map((c) => c.closest('.spot')?.className.replace('spot spot--', ''));

          expect(spots()).toEqual(['top-right', 'center']);

          await hold({ night: true, weekday: true });
          expect(spots()).toEqual(['center', 'bottom-left']);
        });

        it('shows no lock screen over a dashboard', async () => {
          const root = await start({ ...several, display: { ...several.display, lockWidgets: [{ kind: 'clock', spot: 'center' }] } });
          expect(root.querySelector('hd-lock-screen')).toBeNull();
        });
      });
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

    it('returns to the first when the one shown is no longer offered', async () => {
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
      display: { ...hallway, dashboardIds: ['k1'] },
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
  describe('touches', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
    afterEach(() => vi.useRealTimers());

    it('tells HomeyDash at once, then at most once per interval while touching goes on', async () => {
      const root = await start(published(1));
      const touch = () => root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      touch();
      touch();
      expect(realtime.touches).toBe(1);

      vi.advanceTimersByTime(TOUCH_REPORT_MS);
      touch();
      expect(realtime.touches).toBe(2);
    });

    it('reports none while it is in setup', async () => {
      const root = await start(null);

      root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      expect(realtime.touches).toBe(0);
    });
  });

  describe('brightness', () => {
    let levels: (number | null)[];
    let measured: number;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      levels = [];
      measured = 0;
      picked = [];
      TestBed.overrideProvider(LightMeter, {
        useValue: {
          available: true,
          camera: signal<string | null>(null),
          hasCamera: true,
          reading: signal(null),
          scale: signal(1),
          calibrate: () => undefined,
          cameras: async () => [
            { deviceId: 'f', label: 'FaceTime HD Camera' },
            { deviceId: 'i', label: 'iPhone Camera' },
          ],
          choose: (deviceId: string | null) => picked.push(deviceId),
          measure: async () => {
            measured++;
            return levels.length ? (levels.shift() as number | null) : 50;
          },
        },
      });
    });
    afterEach(() => vi.useRealTimers());
    let picked: (string | null)[];

    const corner = (root: HTMLElement) =>
      root.querySelector('.corner')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const settings = (root: HTMLElement) => root.querySelector<HTMLDialogElement>('hd-screen-settings dialog');

    it('opens the screen settings after quick taps in the top-right corner, not slow ones', async () => {
      const root = await start(published(1));
      for (let i = 1; i < SETTINGS_TAPS; i++) corner(root);
      vi.advanceTimersByTime(SETTINGS_TAPS_MS);
      corner(root);
      expect(settings(root)?.open).toBe(false);

      for (let i = 1; i < SETTINGS_TAPS; i++) corner(root);
      await vi.advanceTimersByTimeAsync(0);
      await stable();
      expect(settings(root)?.open).toBe(true);
      const select = root.querySelector('#screen-camera') as HTMLSelectElement;
      expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['Automatic', 'FaceTime HD Camera', 'iPhone Camera']);
    });

    it('measures again at once with the camera picked there', async () => {
      const root = await start(published(1));
      await stable();
      expect(measured).toBe(1);
      for (let i = 0; i < SETTINGS_TAPS; i++) corner(root);
      await vi.advanceTimersByTimeAsync(0);
      await stable();

      const select = root.querySelector('#screen-camera') as HTMLSelectElement;
      select.value = 'i';
      select.dispatchEvent(new Event('change'));
      await stable();

      expect(picked).toEqual(['i']);
      expect(measured).toBe(2);
      expect(realtime.brightnesses).toEqual([50, 50]);
    });

    it('reports the room\'s brightness once a display, and every while after', async () => {
      levels = [12, 64];
      await start(published(1));
      await stable();
      expect(realtime.brightnesses).toEqual([12]);

      await vi.advanceTimersByTimeAsync(BRIGHTNESS_MS);
      expect(realtime.brightnesses).toEqual([12, 64]);
    });

    it('measures nothing during setup', async () => {
      await start(null);
      await vi.advanceTimersByTimeAsync(BRIGHTNESS_MS);

      expect(measured).toBe(0);
    });

    it('stops once the camera is refused', async () => {
      levels = [null];
      await start(published(1));
      await vi.advanceTimersByTimeAsync(BRIGHTNESS_MS * 3);

      expect(measured).toBe(1);
      expect(realtime.brightnesses).toEqual([]);
    });
  });
});
