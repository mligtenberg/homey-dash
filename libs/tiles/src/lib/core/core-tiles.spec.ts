import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HomeyCapability, HomeyDevice, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { TileSize } from '@homey-dash/layout';
import { RealtimeTileData } from '../realtime-tile-data';
import { TileData } from '../tile-data';
import { FlowTile } from './action-tiles';
import { DeviceTile } from './device-tile';
import { drawChart, logOwner, StatisticTile } from './statistic-tile';
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
  ...change,
});

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
    realtime.push('DeviceChanged', d);
    await settle();
  }

  describe('device tile', () => {
    it('toggles on tap, and turns active only when Homey reports it', async () => {
      const tile = await render(DeviceTile, 'd1');
      await push(device([capability('onoff', false)]));

      tile.click();
      await settle();

      expect(realtime.commands).toEqual([['setCapability', 'd1', 'onoff', true]]);
      expect(tile.classList).not.toContain('is-active');

      await push(device([capability('onoff', true)]));
      expect(tile.classList).toContain('is-active');
      expect(tile.textContent).toContain('On');
    });

    it('acts on Enter and Space like a tap', async () => {
      const tile = await render(DeviceTile, 'd1');
      await push(device([capability('onoff', true)]));

      expect(tile.getAttribute('role')).toBe('button');
      tile.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      tile.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      await settle();

      expect(realtime.commands).toEqual([
        ['setCapability', 'd1', 'onoff', false],
        ['setCapability', 'd1', 'onoff', false],
      ]);
    });

    it('gives a dimmer a slider on a wide tile, but not on a small one', async () => {
      const wide = await render(DeviceTile, 'd1', 'wide');
      await push(device([capability('onoff', true), capability('dim', 0.65)]));

      expect(wide.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')).toBe('65');
      wide.querySelector('[role="slider"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      await settle();
      expect(realtime.commands).toEqual([['setCapability', 'd1', 'dim', 0.75]]);

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

      expect(realtime.commands).toEqual([['setCapability', 'd1', 'target_temperature', 21.5]]);
    });

    it('sets a cover from its segmented control', async () => {
      const tile = await render(DeviceTile, 'd1', 'wide');
      await push(device([capability('windowcoverings_state', 'idle')], { class: 'curtain' }));

      const buttons = [...tile.querySelectorAll('.hd-segmented button')] as HTMLElement[];
      expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
      buttons[2].click();
      await settle();

      expect(realtime.commands).toEqual([['setCapability', 'd1', 'windowcoverings_state', 'down']]);
    });

    it('shows a sensor value with its unit, and is not tappable', async () => {
      const tile = await render(DeviceTile, 'd1');
      await push(device([capability('measure_temperature', 19.04, { units: '°C', setable: false, title: 'Temperature' })], { class: 'sensor' }));

      expect(tile.querySelector('.hd-value')?.textContent).toBe('19°C');
      expect(tile.hasAttribute('data-tap')).toBe(false);
    });

    it('keeps the last value of an unavailable device, faded with a badge', async () => {
      const tile = await render(DeviceTile, 'd1');
      await push(device([capability('onoff', true)], { available: false }));

      expect(tile.classList).toContain('is-unavailable');
      expect(tile.textContent).toContain('On');
      expect(tile.querySelector('.hd-badge')?.textContent).toBe('Unavailable');
      tile.click();
      expect(realtime.commands).toEqual([]);
    });

    it('shows a target Homey does not have as missing', async () => {
      const tile = await render(DeviceTile, 'gone');

      expect(tile.classList).toContain('is-missing');
      expect(tile.hasAttribute('data-kind')).toBe(false);
      expect(tile.textContent).toContain('Not found in Homey');
    });
  });

  describe('flow tile', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => vi.useRealTimers());

    async function flowTile() {
      const tile = await render(FlowTile, 'f1');
      realtime.push('Catalog', { flows: [{ id: 'f1', name: 'Good night', advanced: false, enabled: true }], moods: [] });
      await settle();
      return tile;
    }

    it('starts the flow, says so, then returns to rest', async () => {
      const tile = await flowTile();

      tile.click();
      await settle();
      expect(realtime.commands).toEqual([['triggerFlow', 'f1']]);
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

      tile.click();
      TestBed.tick();

      expect(tile.classList).toContain('is-feedback');
      expect(tile.textContent).toContain('Started');
    });

    it('shows an error when the flow could not start', async () => {
      const tile = await flowTile();
      realtime.failCommands = true;

      tile.click();
      await settle();

      expect(tile.classList).toContain('is-error');
      expect(tile.classList).not.toContain('is-feedback');
      expect(tile.textContent).toContain('Could not start');
    });
  });

  describe('statistic tile', () => {
    const logId = 'homey:device:d1:measure_power';

    it('charts the log history and appends live values from the owner device', async () => {
      const tile = await render(StatisticTile, logId, 'large');
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('/api/homey/insights').flush([
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
    });

    it('loads the history again after a reconnect', async () => {
      await render(StatisticTile, logId, 'large');
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('/api/homey/insights').flush([
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
    expect(chart.dot).toEqual({ x: 100, y: 6 });
    expect(chart.grid.map((g) => g.label)).toEqual(['10', '20', '30']);
  });
});
