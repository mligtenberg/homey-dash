import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HomeyCapability, HomeyDevice, PhotoSet, photoUrl, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { TileSize } from '@homey-dash/layout';
import { RealtimeTileData } from '../realtime-tile-data';
import { TileData } from '../tile-data';
import { FlowTile, MoodTile } from './action-tiles';
import { DeviceTile } from './device-tile';
import { CORE_TILES } from './core-tiles';
import { MoodListTile } from './mood-list-tile';
import { moodTint } from './mood-tint';
import { PhotoTile, shuffled } from './photo-tile';
import { drawChart, logOwner, nearestPoint, StatisticTile } from './statistic-tile';
import { DETAILS_IDLE_MS } from './tile-details';
import { FLASH_MS } from './tile-view';

const capability = (id: string, value: HomeyCapability['value'], change: Partial<HomeyCapability> = {}): HomeyCapability => ({
  id,
  title: id,
  type: typeof value === 'boolean' ? 'boolean' : 'number',
  value,
  units: null,
  setable: true,
  getable: true,
  min: null,
  max: null,
  step: null,
  lastUpdated: null,
  ...change,
});

const device = (capabilities: HomeyCapability[], change: Partial<HomeyDevice> = {}): HomeyDevice => ({
  id: 'd1',
  name: 'Kitchen spots',
  zoneId: null,
  zoneName: 'Kitchen',
  class: 'light',
  available: true,
  unavailableMessage: null,
  capabilities: Object.fromEntries(capabilities.map((c) => [c.id, c])),
  albumArt: null,
  ...change,
});

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

const details = (tile: HTMLElement) => tile.querySelector('dialog') as HTMLDialogElement;
const button = (root: Element, label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label) as HTMLElement;

describe('core tiles', () => {
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

  async function render(component: Type<unknown>, target: string | null, size: TileSize = 'small', extra = {}) {
    TestBed.inject(TileData); // Connects, so pushes reach the tile data.
    await settle();
    const fixture = TestBed.createComponent(component);
    fixture.componentRef.setInput('settings', { target, ...extra });
    fixture.componentRef.setInput('size', size);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  async function push(d: HomeyDevice) {
    realtime.push('DeviceChanged', { accountId: 1, device: d });
    await settle();
  }

  describe('device tile', () => {
    it("reads and acts on its account's Homey", async () => {
      realtime.homeySnapshot = [
        realtime.homeySnapshot[0],
        { ...realtime.homeySnapshot[0], accountId: 2, accountName: 'Holiday home', status: { ...realtime.homeySnapshot[0].status, accountId: 2 } },
      ];
      const tile = await render(DeviceTile, 'd1', 'small', { account: 2 });
      realtime.push('DeviceChanged', { accountId: 1, device: device([capability('onoff', true)], { name: 'Home lamp' }) });
      realtime.push('DeviceChanged', { accountId: 2, device: device([capability('onoff', false)], { name: 'Holiday lamp' }) });
      await settle();

      expect(tile.textContent).toContain('Holiday lamp');
      button(tile, 'Turn on').click();
      await settle();

      expect(realtime.commands).toEqual([['setCapability', 2, 'd1', 'onoff', true]]);
    });

    it('toggles from its corner button, and turns active only when Homey reports it', async () => {
      const tile = await render(DeviceTile, 'd1');
      await push(device([capability('onoff', false)]));

      button(tile, 'Turn on').click();
      await settle();

      expect(realtime.commands).toEqual([['setCapability', undefined, 'd1', 'onoff', true]]);
      expect(tile.classList).not.toContain('is-active');
      expect(details(tile).open).toBe(false);

      await push(device([capability('onoff', true)]));
      expect(tile.classList).toContain('is-active');
      expect(tile.textContent).toContain('On');
      expect(button(tile, 'Turn off')).toBeTruthy();
    });

    it("plays and pauses a speaker over its album art while it plays", async () => {
      const tile = await render(DeviceTile, 'd1');
      const speaker = (playing: boolean) =>
        device(
          [capability('speaker_playing', playing), capability('speaker_track', 'Birds of a Feather'), capability('speaker_artist', 'Billie Eilish')],
          { class: 'speaker', albumArt: { id: 'art 1', version: '7' } },
        );
      await push(speaker(true));

      expect(tile.textContent).toContain('Birds of a Feather · Billie Eilish');
      expect(tile.classList).toContain('has-art');
      expect(tile.style.getPropertyValue('--art')).toContain('/api/homey/images/art%201?account=1&v=7');
      button(tile, 'Pause').click();
      await settle();
      expect(realtime.commands).toEqual([['setCapability', undefined, 'd1', 'speaker_playing', false]]);

      await push(speaker(false));
      expect(tile.textContent).toContain('Not playing');
      expect(tile.classList).not.toContain('has-art');
      expect(button(tile, 'Play')).toBeTruthy();
    });

    it('opens its details on Enter and Space like a tap', async () => {
      const tile = await render(DeviceTile, 'd1');
      await push(device([capability('onoff', true), capability('dim', 0.5)]));

      expect(tile.getAttribute('role')).toBe('button');
      tile.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await settle();
      expect(details(tile).open).toBe(true);

      details(tile).close();
      tile.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      await settle();
      expect(details(tile).open).toBe(true);
      expect(realtime.commands).toEqual([]);
    });

    it('has details only when they show more than the tile', async () => {
      const plug = await render(DeviceTile, 'd1');
      await push(device([capability('onoff', true)]));
      expect(plug.getAttribute('role')).toBeNull();

      await push(device([capability('onoff', true), capability('measure_power', 40, { setable: false })]));
      expect(plug.getAttribute('role')).toBe('button');

      await push(device([capability('onoff', true)], { available: false, unavailableMessage: 'Out of range' }));
      expect(plug.getAttribute('role')).toBe('button');

      const wide = await render(DeviceTile, 'd1', 'wide');
      await push(device([capability('onoff', true), capability('dim', 0.5)]));
      expect(wide.getAttribute('role')).toBeNull();
    });

    it('opens no details on a tap when its kind turns the detail view off', async () => {
      TestBed.inject(TileData);
      const fixture = TestBed.createComponent(DeviceTile);
      fixture.componentRef.setInput('settings', { target: 'd1' });
      fixture.componentRef.setInput('size', 'small');
      fixture.componentRef.setInput('detailView', false);
      await push(device([capability('onoff', true), capability('dim', 0.5)]));
      const tile = fixture.nativeElement as HTMLElement;

      tile.click();
      await settle();

      expect(details(tile).open).toBe(false);
      expect(tile.getAttribute('role')).toBeNull();
      expect(tile.hasAttribute('data-tap')).toBe(false);
    });

    it('gives a dimmer a slider on a wide tile, but not on a small one', async () => {
      const wide = await render(DeviceTile, 'd1', 'wide');
      await push(device([capability('onoff', true), capability('dim', 0.65)]));

      expect(wide.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')).toBe('65');
      wide.querySelector('[role="slider"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      await settle();
      expect(realtime.commands).toEqual([['setCapability', undefined, 'd1', 'dim', 0.75]]);

      const small = await render(DeviceTile, 'd1', 'small');
      expect(small.querySelector('[role="slider"]')).toBeNull();
    });

    it('steps a thermostat target by half a degree without toggling', async () => {
      const tile = await render(DeviceTile, 'd1', 'large');
      await push(
        device(
          [capability('target_temperature', 21, { units: '°C' }), capability('measure_temperature', 20.5, { units: '°C', setable: false })],
          { class: 'thermostat' },
        ),
      );

      expect(tile.querySelector('.hd-value--xl')?.textContent).toBe('20.5°C');
      (tile.querySelector('[aria-label="Raise target"]') as HTMLElement).click();
      await settle();

      expect(realtime.commands).toEqual([['setCapability', undefined, 'd1', 'target_temperature', 21.5]]);
    });

    it('sets a cover from its segmented control', async () => {
      const tile = await render(DeviceTile, 'd1', 'wide');
      await push(device([capability('windowcoverings_state', 'idle')], { class: 'curtain' }));

      const buttons = [...tile.querySelectorAll('.hd-segmented button')] as HTMLElement[];
      expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
      buttons[2].click();
      await settle();

      expect(realtime.commands).toEqual([['setCapability', undefined, 'd1', 'windowcoverings_state', 'down']]);
    });

    it('shows a sensor value with its unit, and opens its readings on tap', async () => {
      const tile = await render(DeviceTile, 'd1');
      await push(
        device(
          [
            capability('measure_temperature', 19.04, { units: '°C', setable: false, title: 'Temperature' }),
            capability('measure_humidity', 48, { units: '%', setable: false, title: 'Humidity' }),
          ],
          { class: 'sensor' },
        ),
      );

      expect(tile.querySelector('.hd-value')?.textContent).toBe('19°C');
      tile.click();
      await settle();

      expect(details(tile).open).toBe(true);
      expect(details(tile).querySelector('.hd-details__readings')?.textContent).toContain('Humidity');
      expect(realtime.commands).toEqual([]);
    });

    it('keeps the last value of an unavailable device, faded with a badge', async () => {
      const tile = await render(DeviceTile, 'd1');
      await push(device([capability('onoff', true)], { available: false }));

      expect(tile.classList).toContain('is-unavailable');
      expect(tile.textContent).toContain('On');
      expect(tile.querySelector('.hd-badge')?.textContent).toBe('Unavailable');
      expect((button(tile, 'Turn off') as HTMLButtonElement).disabled).toBe(true);
    });

    describe('details', () => {
      const thermostat = () =>
        device(
          [capability('target_temperature', 21, { units: '°C', max: 21.5 }), capability('measure_temperature', 20.5, { units: '°C', setable: false })],
          { class: 'thermostat', name: 'Living room' },
        );

      it('open on tap of a small thermostat, which can be adjusted there', async () => {
        const tile = await render(DeviceTile, 'd1', 'small');
        await push(thermostat());
        expect(tile.querySelector('[aria-label="Raise target"]')).toBeNull();

        tile.click();
        await settle();

        const dialog = details(tile);
        expect(dialog.open).toBe(true);
        expect(dialog.querySelector('.hd-details__name')?.textContent).toBe('Living room');
        expect(dialog.querySelector('.hd-details__sub')?.textContent).toBe('Kitchen');
        expect(dialog.querySelector('.hd-value--l')?.textContent).toBe('20.5°C');
        button(dialog, 'Raise target').click();
        button(dialog, 'Lower target').click();
        await settle();

        expect(realtime.commands).toEqual([
          ['setCapability', undefined, 'd1', 'target_temperature', 21.5],
          ['setCapability', undefined, 'd1', 'target_temperature', 20.5],
        ]);
        expect(dialog.open).toBe(true);
      });

      it('do not open from inline controls', async () => {
        const large = await render(DeviceTile, 'd1', 'large');
        await push(thermostat());
        button(large, 'Raise target').click();

        const wide = await render(DeviceTile, 'd1', 'wide');
        await push(device([capability('windowcoverings_state', 'idle')], { class: 'curtain' }));
        button(wide, 'Down').click();

        const dimmer = await render(DeviceTile, 'd1', 'wide');
        await push(device([capability('onoff', true), capability('dim', 0.4)]));
        dimmer.querySelector('[role="slider"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await settle();

        button(dimmer, 'Turn off').click();
        await settle();

        expect([large, wide, dimmer].map((tile) => details(tile).open)).toEqual([false, false, false]);
        expect(realtime.commands.length).toBe(3);
      });

      it('open on a tap of a light, with every control though the small tile has no slider', async () => {
        const tile = await render(DeviceTile, 'd1', 'small');
        await push(device([capability('onoff', true), capability('dim', 0.4)]));
        expect(tile.querySelector('[role="slider"]')).toBeNull();

        tile.click();
        await settle();

        const dialog = details(tile);
        expect(dialog.open).toBe(true);
        expect(realtime.commands).toEqual([]);
        button(dialog, 'Off').click();
        dialog.querySelector('[role="slider"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        await settle();
        expect(realtime.commands).toEqual([
          ['setCapability', undefined, 'd1', 'onoff', false],
          ['setCapability', undefined, 'd1', 'dim', 0.5],
        ]);
      });

      it('close with the close button, a tap outside, Escape, or after a minute untouched', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
          const tile = await render(DeviceTile, 'd1');
          await push(thermostat());
          const dialog = details(tile);
          const open = async () => {
            tile.click();
            await settle();
            expect(dialog.open).toBe(true);
          };

          await open();
          button(dialog, 'Close').click();
          await settle();
          expect(dialog.open).toBe(false);
          expect(dialog.querySelector('.hd-details__panel')).toBeNull();

          await open();
          dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          dialog.click();
          expect(dialog.open).toBe(false);

          // A drag from a control that ends outside the panel is not a tap outside.
          await open();
          (dialog.querySelector('.hd-round-btn') as HTMLElement).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          dialog.click();
          expect(dialog.open).toBe(true);

          dialog.close(); // What the browser does on Escape.
          await open();
          vi.advanceTimersByTime(DETAILS_IDLE_MS);
          expect(dialog.open).toBe(false);
          expect(realtime.commands).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    it('shows a target Homey does not have as missing', async () => {
      const tile = await render(DeviceTile, 'gone');

      expect(tile.classList).toContain('is-missing');
      expect(tile.hasAttribute('data-kind')).toBe(false);
      expect(tile.hasAttribute('data-tap')).toBe(false);
      expect(tile.textContent).toContain('Not found in Homey');
    });
  });

  describe('flow tile', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => vi.useRealTimers());

    async function flowTile() {
      const tile = await render(FlowTile, 'f1');
      realtime.push('Catalog', {
        accountId: 1,
        flows: [{ id: 'f1', name: 'Good night', advanced: false, enabled: true, folderId: null }],
        moods: [],
        zones: [],
        flowFolders: [],
      });
      await settle();
      return tile;
    }

    it('starts the flow from its corner button, says so, then returns to rest', async () => {
      const tile = await flowTile();

      button(tile, 'Start').click();
      await settle();
      expect(realtime.commands).toEqual([['triggerFlow', undefined, 'f1']]);
      expect(tile.classList).toContain('is-feedback');
      expect(tile.textContent).toContain('Started');

      vi.advanceTimersByTime(FLASH_MS);
      await settle();
      expect(tile.classList).not.toContain('is-feedback');
      expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('Flow');
    });

    it('says so on press, without waiting for Homey to answer', async () => {
      const tile = await flowTile();
      vi.spyOn(realtime, 'triggerFlow').mockReturnValue(new Promise(() => undefined));

      button(tile, 'Start').click();
      TestBed.tick();

      expect(tile.classList).toContain('is-feedback');
      expect(tile.textContent).toContain('Started');
    });

    it('has no details, so a tap beside its button does nothing', async () => {
      const tile = await flowTile();

      tile.click();
      await settle();

      expect(tile.querySelector('dialog')).toBeNull();
      expect(tile.getAttribute('role')).toBeNull();
      expect(realtime.commands).toEqual([]);
    });

    it('activates a mood from its corner button, in a wash of its colours that glows while it confirms', async () => {
      const tile = await render(MoodTile, 'm1');
      realtime.push('Catalog', {
        accountId: 1,
        flows: [],
        moods: [{ id: 'm1', name: 'Movie night', zoneId: null, colors: [{ hue: 0.5, saturation: 1, temperature: null }] }],
        zones: [],
        flowFolders: [],
      });
      await settle();
      expect(tile.classList).toContain('has-tint');
      expect(tile.style.getPropertyValue('--tile-tint')).toContain('hsl(180 100% 70%)');

      button(tile, 'Activate').click();
      await settle();

      expect(realtime.commands).toEqual([['activateMood', undefined, 'm1']]);
      expect(tile.classList).toContain('is-feedback');
    });

    it('has a mood kind without a detail view', () => {
      expect(CORE_TILES.kinds.find((k) => k.id === 'mood')?.details).toBe(false);
    });

    it('shows an error when the flow could not start', async () => {
      const tile = await flowTile();
      realtime.failCommands = true;

      button(tile, 'Start').click();
      await settle();

      expect(tile.classList).toContain('is-error');
      expect(tile.classList).not.toContain('is-feedback');
      expect(tile.textContent).toContain('Could not start');
    });
  });

  describe('mood list tile', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => vi.useRealTimers());

    async function moodList(targets: string[]) {
      const tile = await render(MoodListTile, null, 'wide', { targets, label: 'Living room' });
      realtime.push('Catalog', {
        accountId: 1,
        flows: [],
        moods: [
          { id: 'm1', name: 'Movie night', zoneId: null, colors: [{ hue: 0.5, saturation: 1, temperature: null }] },
          { id: 'm2', name: 'Dinner', zoneId: null, colors: [] },
          { id: 'm3', name: 'Reading', zoneId: null, colors: [] },
          { id: 'm4', name: 'Focus', zoneId: null, colors: [] },
          { id: 'm5', name: 'Bedtime', zoneId: null, colors: [] },
        ],
        zones: [],
        flowFolders: [],
      });
      await settle();
      return tile;
    }

    const moodButtons = (tile: HTMLElement) => [...tile.querySelectorAll('.hd-mood-list__btn')] as HTMLButtonElement[];

    it('shows a button per mood in order, and activates the one pressed', async () => {
      const tile = await moodList(['m2', 'm1']);

      expect(moodButtons(tile).map((b) => b.textContent?.trim())).toEqual(['Dinner', 'Movie night']);
      button(tile, 'Activate Movie night').click();
      await settle();

      expect(realtime.commands).toEqual([['activateMood', undefined, 'm1']]);
      expect(tile.classList).toContain('is-feedback');
      expect(moodButtons(tile)[1].classList).toContain('is-pressed');
      expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('Movie night activated');

      vi.advanceTimersByTime(FLASH_MS);
      await settle();
      expect(moodButtons(tile)[1].classList).not.toContain('is-pressed');
      expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('');
    });

    it('puts moods that do not fit on further pages, with a dot per page', async () => {
      const tile = await moodList(['m1', 'm2', 'm3', 'm4', 'm5']);
      const pages = [...tile.querySelectorAll('.hd-mood-list__page')];

      expect(pages.map((p) => p.querySelectorAll('button').length)).toEqual([4, 1]);
      expect(button(tile, 'Show moods 1 of 2').getAttribute('aria-current')).toBe('true');
      expect(button(tile, 'Show moods 2 of 2')).toBeTruthy();
    });

    it('shows its outcome in place of the page dots', async () => {
      const tile = await moodList(['m1', 'm2', 'm3', 'm4', 'm5']);

      button(tile, 'Activate Dinner').click();
      await settle();

      expect(tile.querySelector('.hd-mood-list__dots')).toBeNull();
      expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('Dinner activated');
    });

    it('tints a button with the colours its mood sets', async () => {
      const tile = await moodList(['m1', 'm2']);

      expect(button(tile, 'Activate Movie night').style.getPropertyValue('--mood-tint')).toContain('hsl(180 100% 70%)');
      expect(button(tile, 'Activate Dinner').style.getPropertyValue('--mood-tint')).toBe('');
    });

    it('glows in the colours of the mood pressed while it flashes', async () => {
      const tile = await moodList(['m1', 'm2']);

      button(tile, 'Activate Movie night').click();
      await settle();
      expect(tile.classList).toContain('has-tint');
      expect(tile.style.getPropertyValue('--tile-tint')).toContain('hsl(180 100% 70%)');

      vi.advanceTimersByTime(FLASH_MS);
      await settle();
      expect(tile.classList).not.toContain('has-tint');

      button(tile, 'Activate Dinner').click();
      await settle();
      expect(tile.classList).not.toContain('has-tint');
    });

    it('counts lights of about the same colour once, and at most three colours', () => {
      const color = (hue: number) => ({ hue, saturation: 1, temperature: null });
      const white = (temperature: number) => ({ hue: null, saturation: null, temperature });

      expect(moodTint([color(0.5), color(0.51), white(1), white(0.95)])).toBe(
        'linear-gradient(90deg, hsl(180 100% 70%), color-mix(in oklab, #ffb35c 100%, #d6e8ff))',
      );
      expect(moodTint([color(0), color(0.25), color(0.5), color(0.75)])?.match(/hsl/g)).toHaveLength(3);
      expect(moodTint([])).toBeNull();
    });

    it('has no detail view, so a tap beside the buttons does nothing', async () => {
      const tile = await moodList(['m1']);

      tile.click();
      await settle();

      expect(tile.querySelector('dialog')).toBeNull();
      expect(tile.getAttribute('role')).toBeNull();
      expect(realtime.commands).toEqual([]);
    });

    it('disables a mood Homey does not have, and is missing when it has none of them', async () => {
      const tile = await moodList(['m1', 'gone']);
      expect(moodButtons(tile)[1].disabled).toBe(true);

      const lost = await moodList(['gone']);
      expect(lost.classList).toContain('is-missing');
    });

    it('asks for moods until some are picked', async () => {
      const tile = await moodList([]);

      expect(tile.textContent).toContain('Pick moods');
      expect(moodButtons(tile)).toEqual([]);
    });
  });

  describe('statistic tile', () => {
    const logId = 'homey:device:d1:measure_power';

    it('charts the log history and appends live values from the owner device', async () => {
      const tile = await render(StatisticTile, logId, 'large');
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('/api/homey/insights?account=1').flush([
        { id: logId, ownerUri: 'homey:device:d1', ownerName: 'Washer', title: 'Power', type: 'number', units: 'W' },
      ]);
      TestBed.tick(); // Not whenStable: the history load is a pending task until it is answered.
      http
        .expectOne((r) => r.url === '/api/homey/insights/entries' && r.params.get('log') === logId && r.params.get('resolution') === 'last24Hours')
        .flush([
          { t: '2026-10-25T10:00:00Z', v: 100 },
          { t: '2026-10-25T11:00:00Z', v: 300 },
        ]);
      await settle();

      expect(tile.classList).toContain('hd-stat');
      expect(tile.getAttribute('data-kind')).toBe('energy');
      expect(tile.querySelector('.hd-chart__line')?.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
      expect(tile.querySelector('.hd-chart__dot')).not.toBeNull();
      expect(tile.querySelector('.hd-value')?.textContent).toBe('300W');

      await push(device([capability('measure_power', 450, { units: 'W', lastUpdated: '2026-10-25T11:30:00Z' })], { class: 'washer' }));
      expect(tile.querySelector('.hd-value')?.textContent).toBe('450W');
      expect(tile.querySelector('.hd-chart__line')?.getAttribute('d')?.split('L')).toHaveLength(3);

      tile.click();
      await settle();
      const dialog = details(tile);
      expect(dialog.open).toBe(true);
      expect(dialog.querySelector('.hd-value--xl')?.textContent).toBe('450W');
      expect(dialog.querySelector('.hd-chart__line')?.getAttribute('d')?.split('L')).toHaveLength(3);
    });

    it('loads the history again after a reconnect', async () => {
      await render(StatisticTile, logId, 'large');
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('/api/homey/insights?account=1').flush([
        { id: logId, ownerUri: 'homey:device:d1', ownerName: 'Washer', title: 'Power', type: 'number', units: 'W' },
      ]);
      TestBed.tick();
      const entries = (r: { url: string }) => r.url === '/api/homey/insights/entries';
      http.expectOne(entries).flush([{ t: '2026-10-25T10:00:00Z', v: 100 }]);
      await settle();

      realtime.connected.set(false);
      TestBed.tick();
      realtime.connected.set(true);
      TestBed.tick();

      http.expectOne(entries);
    });
  });

  describe('photo tile', () => {
    const photoSet = (count: number, change: Partial<PhotoSet> = {}): PhotoSet => ({
      id: 's1',
      name: 'Summer',
      target: 'photo-set:s1',
      accountId: 1,
      accountName: 'Immich',
      albumId: 'a1',
      albumName: 'Summer',
      selection: null,
      photos: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, takenAt: '2026-08-12T10:00:00Z', place: null, faces: null })),
      syncedAt: null,
      skippedVideos: 0,
      syncError: null,
      syncing: false,
      dashboards: [],
      excluded: [],
      lockedOwners: [],
      ...change,
    });

    it('fills the tile with a photo of its set, named after the set', async () => {
      realtime.photoSetList = [photoSet(3)];

      const tile = await render(PhotoTile, 'photo-set:s1', 'large');

      expect(tile.classList).toContain('has-photo');
      expect(tile.querySelector('img')?.getAttribute('src')).toMatch(/^\/api\/photos\/s1\/p[012]$/);
    });

    it('asks for a photo at the size of the tile, cropped by HomeyDash around its faces', () => {
      const photo = { id: 'p0', version: 'h/1', faces: { focus: { x: 0.2, y: 0.15 }, people: [] } };
      expect(photoUrl({ id: 's1' }, photo, { width: 400, height: 250 }, 2)).toBe('/api/photos/s1/p0?v=h%2F1&width=800&height=512&faces=1');
      // Whole, as the detail view shows it; and before its faces are read.
      expect(photoUrl({ id: 's1' }, photo)).toBe('/api/photos/s1/p0?v=h%2F1');
      expect(photoUrl({ id: 's1' }, { id: 'p0' }, { width: 400, height: 250 }, 1)).toBe('/api/photos/s1/p0?width=400&height=256');
    });

    it('shows the label over the photo only when one is set', async () => {
      realtime.photoSetList = [photoSet(1)];

      const tile = await render(PhotoTile, 'photo-set:s1', 'large', { label: 'Holiday' });

      expect(tile.querySelector('.hd-photo__label')?.textContent?.trim()).toBe('Holiday');
    });

    it('says along the bottom of the photo when and where it was taken', async () => {
      const set = photoSet(1);
      realtime.photoSetList = [{ ...set, photos: [{ ...set.photos[0], place: 'Utrecht, Netherlands' }] }];

      const tile = await render(PhotoTile, 'photo-set:s1', 'large');

      expect(tile.querySelector('.hd-photo__label')).toBeNull();
      const about = tile.querySelector('.hd-photo__about')?.textContent;
      expect(about).toContain('2026');
      expect(about).toContain(' · Utrecht, Netherlands');
    });

    it('names who is on the photo at the bottom right only when asked to', async () => {
      const set = photoSet(1);
      realtime.photoSetList = [{ ...set, photos: [{ ...set.photos[0], faces: { focus: { x: 0.5, y: 0.5 }, people: ['Anna', 'Bram'] } }] }];
      TestBed.inject(TileData);
      await settle();
      const fixture = TestBed.createComponent(PhotoTile);
      fixture.componentRef.setInput('settings', { target: 'photo-set:s1' });
      fixture.componentRef.setInput('size', 'large');
      await settle();
      const tile = fixture.nativeElement as HTMLElement;
      expect(tile.querySelector('.hd-photo__people')).toBeNull();

      fixture.componentRef.setInput('people', true);
      await settle();

      expect(tile.querySelector('.hd-photo__people')?.textContent?.trim()).toBe('Anna, Bram');
    });

    it('opens the photo whole on a tap, with the date it was taken, and steps through the set', async () => {
      realtime.photoSetList = [photoSet(3)];
      const tile = await render(PhotoTile, 'photo-set:s1', 'large');

      tile.click();
      await settle();

      const dialog = details(tile);
      expect(dialog.open).toBe(true);
      expect(dialog.querySelector('.hd-details__sub')?.textContent).toContain('2026');
      const first = dialog.querySelector('.hd-photo-details__img')?.getAttribute('src');
      button(dialog, 'Next photo').click();
      await settle();
      expect(dialog.querySelector('.hd-photo-details__img')?.getAttribute('src')).not.toBe(first);
      expect(dialog.textContent).toContain('of 3');
      // Without a place or anyone on them, there is nothing under the photo.
      expect(dialog.querySelector('.hd-photo-details__meta')).toBeNull();
    });

    it('steps through the set with the arrow keys while the photo is open', async () => {
      realtime.photoSetList = [photoSet(3)];
      const tile = await render(PhotoTile, 'photo-set:s1', 'large');
      const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
      const position = () => details(tile).querySelector('.hd-details__label')?.textContent?.trim();

      // Closed, the arrows leave the tile as it is.
      key(tile, 'ArrowRight');
      tile.click();
      await settle();
      expect(position()).toBe('1 of 3');

      key(button(details(tile), 'Close'), 'ArrowRight');
      await settle();
      expect(position()).toBe('2 of 3');
      key(button(details(tile), 'Close'), 'ArrowLeft');
      key(button(details(tile), 'Close'), 'ArrowLeft');
      await settle();
      expect(position()).toBe('3 of 3');
    });

    it('says where a photo was taken and who is on it', async () => {
      const set = photoSet(1);
      const photo = { ...set.photos[0], place: 'Utrecht, Netherlands', faces: { focus: { x: 0.5, y: 0.5 }, people: ['Anna', 'Bram'] } };
      realtime.photoSetList = [{ ...set, photos: [photo] }];
      const tile = await render(PhotoTile, 'photo-set:s1', 'large');

      tile.click();
      await settle();

      const meta = details(tile).querySelector('.hd-photo-details__meta')?.textContent;
      expect(meta).toContain('Utrecht, Netherlands');
      expect(meta).toContain('Anna, Bram');
    });

    describe('rotating a photo', () => {
      const detailSrc = (tile: HTMLElement) => details(tile).querySelector('.hd-photo-details__img')?.getAttribute('src');

      it('turns the photo in Immich and shows it turned, on the tile too, once HomeyDash has it', async () => {
        realtime.photoSetList = [photoSet(1)];
        const tile = await render(PhotoTile, 'photo-set:s1', 'large');
        tile.click();
        await settle();

        button(details(tile), 'Rotate right').click();
        await settle();
        const request = TestBed.inject(HttpTestingController).expectOne('/api/photo-sets/s1/photos/p0/rotate');
        expect(request.request.method).toBe('POST');
        expect(request.request.body).toEqual({ degrees: 90 });
        expect(details(tile).querySelector('[role="status"]')?.textContent).toContain('Rotating');
        expect((button(details(tile), 'Rotate left') as HTMLButtonElement).disabled).toBe(true);
        const turned = photoSet(1, { photos: [{ ...photoSet(1).photos[0], version: 'h/1' }] });
        realtime.push('PhotoSets', [turned]);
        request.flush(turned);
        await settle();

        expect(details(tile).open).toBe(true);
        expect(detailSrc(tile)).toBe('/api/photos/s1/p0?v=h%2F1');
        expect(tile.querySelector('.hd-photo__img')?.getAttribute('src')).toBe('/api/photos/s1/p0?v=h%2F1');
        expect((button(details(tile), 'Rotate left') as HTMLButtonElement).disabled).toBe(false);
      });

      it('turns it the other way, and says why when Immich could not', async () => {
        realtime.photoSetList = [photoSet(1)];
        const tile = await render(PhotoTile, 'photo-set:s1', 'large');
        tile.click();
        await settle();

        button(details(tile), 'Rotate left').click();
        const request = TestBed.inject(HttpTestingController).expectOne('/api/photo-sets/s1/photos/p0/rotate');
        expect(request.request.body).toEqual({ degrees: -90 });
        request.flush(
          { detail: "Immich can't rotate this photo: Editing live photos is not supported." },
          { status: 502, statusText: 'Bad Gateway' },
        );
        await settle();

        expect(details(tile).querySelector('[role="alert"]')?.textContent).toContain('Editing live photos is not supported');
        expect(detailSrc(tile)).toBe('/api/photos/s1/p0');
      });

      it("can't turn a partner's photo without a key of theirs", async () => {
        const set = photoSet(2, { lockedOwners: ['u2'] });
        realtime.photoSetList = [{ ...set, photos: [{ ...set.photos[0], ownerId: 'u2' }, { ...set.photos[1], ownerId: 'u1' }] }];
        const tile = await render(PhotoTile, 'photo-set:s1', 'large');
        tile.click();
        await settle();
        const disabled = () => (button(details(tile), 'Rotate right') as HTMLButtonElement).disabled;

        const first = disabled();
        button(details(tile), 'Next photo').click();
        await settle();

        // The order is shuffled: one of the two is the partner's.
        expect([first, disabled()].sort()).toEqual([false, true]);
      });
    });

    describe('excluding a photo', () => {
      // jsdom decodes no images; the tile fades a photo in only once it has.
      beforeEach(() => {
        HTMLImageElement.prototype.decode = () => Promise.resolve();
      });
      afterEach(() => {
        delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode;
      });

      const idOf = (img: Element | null | undefined) => img?.getAttribute('src')?.split('/').pop() ?? '';
      const shownId = (tile: HTMLElement) => idOf([...tile.querySelectorAll('.hd-photo__img')].pop());

      it('excludes the photo in the detail view, which moves on to the next photo, and moves the tile on too', async () => {
        realtime.photoSetList = [photoSet(3)];
        const tile = await render(PhotoTile, 'photo-set:s1', 'large');
        const excluded = shownId(tile);
        tile.click();
        await settle();

        button(details(tile), 'Exclude photo').click();
        const request = TestBed.inject(HttpTestingController).expectOne(`/api/photo-sets/s1/excluded/${excluded}`);
        expect(request.request.method).toBe('PUT');
        const left = photoSet(3).photos.filter((p) => p.id !== excluded);
        // HomeyDash pushes the set without it before it answers.
        realtime.push('PhotoSets', [photoSet(0, { photos: left })]);
        request.flush(photoSet(0, { photos: left }));
        await settle();
        await settle();

        expect(details(tile).open).toBe(true);
        expect(details(tile).querySelector('.hd-photo-details__img')?.getAttribute('src')).not.toContain(excluded);
        expect(shownId(tile)).not.toBe(excluded);
        expect(left.map((p) => p.id)).toContain(shownId(tile));
      });

      it('keeps the photo shown on the tile when another one is excluded', async () => {
        realtime.photoSetList = [photoSet(3)];
        const tile = await render(PhotoTile, 'photo-set:s1', 'large');
        const shown = shownId(tile);
        tile.click();
        await settle();
        button(details(tile), 'Next photo').click();
        await settle();
        const excluded = idOf(details(tile).querySelector('.hd-photo-details__img'));

        button(details(tile), 'Exclude photo').click();
        const left = photoSet(3).photos.filter((p) => p.id !== excluded);
        realtime.push('PhotoSets', [photoSet(0, { photos: left })]);
        TestBed.inject(HttpTestingController).expectOne(`/api/photo-sets/s1/excluded/${excluded}`).flush(photoSet(0, { photos: left }));
        await settle();

        expect(shownId(tile)).toBe(shown);
        expect(tile.querySelectorAll('.hd-photo__img')).toHaveLength(1);
      });

      it('says so and stays open when HomeyDash could not exclude it', async () => {
        realtime.photoSetList = [photoSet(2)];
        const tile = await render(PhotoTile, 'photo-set:s1', 'large');
        tile.click();
        await settle();

        button(details(tile), 'Exclude photo').click();
        TestBed.inject(HttpTestingController)
          .expectOne((r) => r.url.startsWith('/api/photo-sets/s1/excluded/'))
          .flush(null, { status: 502, statusText: 'Bad Gateway' });
        await settle();

        expect(details(tile).open).toBe(true);
        expect(details(tile).querySelector('[role="alert"]')?.textContent).toContain('Could not exclude the photo');
      });
    });

    it('asks for a photo set, says when its album has no photos, and is missing when it was deleted', async () => {
      realtime.photoSetList = [photoSet(0)];

      expect((await render(PhotoTile, null)).textContent).toContain('Pick a photo set');
      expect((await render(PhotoTile, 'photo-set:s1')).textContent).toContain('No photos in the album');
      const gone = await render(PhotoTile, 'photo-set:gone');
      expect(gone.classList).toContain('is-missing');
      expect(gone.textContent).toContain('Photo set not found');
    });

    it('follows its album as it syncs', async () => {
      realtime.photoSetList = [photoSet(0)];
      const tile = await render(PhotoTile, 'photo-set:s1', 'large');
      expect(tile.querySelector('img')).toBeNull();

      realtime.push('PhotoSets', [photoSet(2)]);
      await settle();

      expect(tile.querySelector('img')).not.toBeNull();
    });

    it('has a photo kind of every size, pointing at a photo set', () => {
      const kind = CORE_TILES.kinds.find((k) => k.id === 'photo');
      expect(kind?.target).toBe('photoSet');
      expect(kind?.sizes).toEqual(['small', 'wide', 'full', 'large', 'full-large']);
    });
  });
});

describe('shuffled', () => {
  it('keeps every item once, in an order of its own', () => {
    let seed = 0;
    const random = () => [0.9, 0.1, 0.5, 0.3][seed++ % 4];

    const order = shuffled([1, 2, 3, 4, 5], random);

    expect([...order].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(order).not.toEqual([1, 2, 3, 4, 5]);
  });
});

describe('logOwner', () => {
  it('follows measure_power for Homey\'s energy_power log', () => {
    expect(logOwner('homey:device:d1:energy_power')).toEqual({ deviceId: 'd1', capability: 'measure_power' });
    expect(logOwner('homey:device:d1:measure_temperature')).toEqual({ deviceId: 'd1', capability: 'measure_temperature' });
    expect(logOwner('homey:manager:weather:temperature')).toBeNull();
  });
});

describe('drawChart', () => {
  it('runs the window left to right and spans round grid lines', () => {
    const chart = drawChart(
      [
        { t: '2026-10-25T00:00:00Z', v: 10 },
        { t: '2026-10-25T00:30:00Z', v: null },
        { t: '2026-10-25T01:00:00Z', v: 30 },
      ],
      3_600_000,
      100,
      100,
    );

    expect(chart.line).toBe('M0,84 M100,6');
    expect(chart.dot).toMatchObject({ x: 100, y: 6 });
    expect(chart.grid.map((g) => g.label)).toEqual(['10', '20', '30']);
  });

  it('keeps the line left of the value labels', () => {
    const entries = [
      { t: '2026-10-25T00:00:00Z', v: 0 },
      { t: '2026-10-25T01:00:00Z', v: 2000 },
    ];
    const chart = drawChart(entries, 3_600_000, 100, 100, 5);

    // The widest label, 2000, plus a character of space.
    expect(chart.right).toBe(75);
    expect(chart.dot).toMatchObject({ x: 75 });
    expect(nearestPoint(chart.points, 30)?.entry).toBe(entries[0]);
    expect(nearestPoint(chart.points, 60)?.entry).toBe(entries[1]);
  });
});
