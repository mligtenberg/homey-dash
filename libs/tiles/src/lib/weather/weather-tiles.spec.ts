import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Forecast, RainPoint, Realtime, WEATHER_HERE, WEATHER_PLACE } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { TileSize } from '@homey-dash/layout';
import { RealtimeTileData } from '../realtime-tile-data';
import { TileData } from '../tile-data';
import { clockTime, rainSummary, WeatherData, weatherLook } from './weather-data';
import { WeatherTileSettingsEditor } from './weather-settings';
import { WeatherTile } from './weather-tile';
import { WEATHER_TILES } from './weather-tiles';

const NOW = new Date('2026-11-08T12:02:00+01:00').getTime();
const hour = (n: number) => new Date(NOW - 2 * 60_000 + n * 3_600_000).toISOString();

const rain = (rates: number[]): RainPoint[] =>
  rates.map((rate, i) => ({ time: new Date(NOW - 2 * 60_000 + i * 300_000).toISOString(), rate }));

const NOW_WEATHER = { temperature: 8.4, feelsLike: 6.1, code: 3, day: true, humidity: 0.91, wind: 11.2, windDirection: 201, precipitation: 0 };

const forecast = (change: Partial<Forecast> = {}): Forecast => ({
  accountId: 1,
  accountName: 'Homey',
  placeKey: null,
  status: 'connected',
  error: null,
  place: 'Utrecht',
  now: NOW_WEATHER,
  hours: Array.from({ length: 24 }, (_, i) => ({
    time: hour(i),
    temperature: 8 + i / 4,
    code: i === 2 ? 61 : 3,
    day: true,
    precipitationChance: i === 2 ? 70 : 10,
    precipitation: 0,
  })),
  days: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-11-${String(8 + i).padStart(2, '0')}`,
    code: i === 1 ? 0 : 3,
    low: 4 - i,
    high: 11 - i,
    precipitationChance: 10,
    precipitation: 0,
    sunrise: '2026-11-08T07:44:00+01:00',
    sunset: '2026-11-08T16:54:00+01:00',
  })),
  rain: rain(Array(25).fill(0)),
  updatedAt: '2026-11-08T12:00:00+01:00',
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

describe('Weather tile', () => {
  let realtime: FakeRealtime;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
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

  afterEach(() => vi.useRealTimers());

  const settle = () => TestBed.inject(ApplicationRef).whenStable();

  async function render(size: TileSize = 'wide', settings: Record<string, unknown> = { target: WEATHER_HERE }) {
    TestBed.inject(WeatherData); // Connects, so pushes reach it.
    await settle();
    const fixture = TestBed.createComponent(WeatherTile);
    fixture.componentRef.setInput('settings', settings);
    fixture.componentRef.setInput('size', size);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the weather now, the place and the day’s high and low', async () => {
    realtime.forecastList = [forecast()];

    const tile = await render('small');

    expect(tile.classList).toContain('has-forecast');
    expect(tile.getAttribute('data-kind')).toBe('climate');
    expect(tile.querySelector('.hd-value')?.textContent).toBe('8°');
    expect(tile.querySelector('.hd-tile__name')?.textContent).toBe('Utrecht');
    expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('Cloudy · 11° / 4°');
    expect(tile.querySelector('.hd-weather__strip')).toBeNull();
  });

  it('shows the coming hours from wide, and the coming days from large', async () => {
    realtime.forecastList = [forecast()];

    const wide = await render('wide');
    expect(wide.querySelectorAll('.hd-weather__ahead li')).toHaveLength(3);
    expect(wide.querySelector('.hd-weather__days')).toBeNull();

    const large = await render('large');
    expect(large.querySelectorAll('.hd-weather__ahead li')).toHaveLength(5);
    const days = [...large.querySelectorAll('.hd-weather__days li')];
    expect(days).toHaveLength(4);
    expect(days[0].textContent).toContain('Today');
    expect(days[1].querySelector('svg')?.getAttribute('aria-label')).toBe('Clear');
  });

  it('says when rain comes, and charts it on a large tile in place of the hours', async () => {
    realtime.forecastList = [forecast({ rain: rain([0, 0, 0, 0, 0, 0, 0.4, 1.2, 2.8, 0.3, 0, 0, 0]) })];

    const tile = await render('large');

    expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe(`Rain from ${clockTime(NOW - 2 * 60_000 + 30 * 60_000)}`);
    expect(tile.querySelectorAll('.hd-weather__rain rect')).toHaveLength(13);
    expect(tile.querySelector('.hd-weather__ahead.hd-weather__strip')).toBeNull();
  });

  it('follows the forecast as it changes', async () => {
    realtime.forecastList = [forecast()];
    const tile = await render('small');

    realtime.push('Forecasts', [forecast({ now: { ...NOW_WEATHER, temperature: -2.6, code: 71 } })]);
    await settle();

    expect(tile.querySelector('.hd-value')?.textContent).toBe('−3°');
    expect(tile.querySelector('.hd-tile__detail')?.textContent).toContain('Light snow');
  });

  it('tells why it has no forecast', async () => {
    realtime.forecastList = [forecast({ status: 'noLocation', now: null, hours: [], days: [], rain: null })];

    const tile = await render('small');

    expect(tile.classList).toContain('is-unavailable');
    expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('Set a location in Homey');
  });

  it('is missing once its Homey account is gone', async () => {
    realtime.forecastList = [forecast()];

    const tile = await render('small', { target: WEATHER_HERE, account: 7 });

    expect(tile.classList).toContain('is-missing');
    expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('Homey not found');
  });

  it('shows the weather at a place of its own instead', async () => {
    const barcelona = { name: 'Barcelona', latitude: 41.389, longitude: 2.159 };
    realtime.forecastList = [
      forecast(),
      forecast({ accountId: null, accountName: null, placeKey: '41.39,2.16', place: 'Barcelona', now: { ...NOW_WEATHER, temperature: 19, code: 0 }, rain: null }),
    ];

    const tile = await render('small', { target: WEATHER_PLACE, place: barcelona });

    expect(tile.querySelector('.hd-value')?.textContent).toBe('19°');
    expect(tile.querySelector('.hd-tile__name')?.textContent).toBe('Barcelona');
    expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('Clear · 11° / 4°');
  });

  it('waits for the forecast of a place just chosen', async () => {
    realtime.forecastList = [forecast()];

    const tile = await render('small', { target: WEATHER_PLACE, place: { name: 'Antwerp', latitude: 51.221, longitude: 4.4 } });

    expect(tile.querySelector('.hd-tile__name')?.textContent).toBe('Antwerp');
    expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('…');
  });

  it('opens the full forecast on a press', async () => {
    realtime.forecastList = [forecast({ rain: rain([0.5, 0.5, 0, 0]) })];
    const tile = await render('wide');

    tile.click();
    await settle();

    const pane = tile.querySelector('.hd-weather__pane') as HTMLElement;
    expect(pane.querySelector('.hd-value--xl')?.textContent).toBe('8°');
    expect(pane.textContent).toContain('Feels like 6°');
    expect(pane.textContent).toContain('91%');
    expect(pane.textContent).toContain('11 km/h S');
    expect(pane.textContent).toContain(`Rain until ${clockTime(NOW - 2 * 60_000 + 10 * 60_000)}`);
    expect(pane.querySelectorAll('.hd-weather__strip--scroll li')).toHaveLength(24);
    expect(pane.querySelectorAll('.hd-weather__week li')).toHaveLength(7);
    expect(pane.textContent).toContain('rain by Buienradar');
  });
});

describe('Weather tile settings', () => {
  let realtime: FakeRealtime;
  beforeEach(() => {
    vi.useFakeTimers();
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

  afterEach(() => vi.useRealTimers());

  async function render(settings: Record<string, unknown>) {
    const fixture = TestBed.createComponent(WeatherTileSettingsEditor);
    fixture.componentRef.setInput('settings', settings);
    const changes: unknown[] = [];
    fixture.componentInstance.changed.subscribe((patch) => changes.push(patch));
    await vi.runAllTimersAsync();
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement, changes };
  }

  it('searches a town and sets it as the place, which needs no Homey', async () => {
    const { fixture, root, changes } = await render({ target: WEATHER_HERE, account: 1 });
    expect(root.textContent).toContain('Homey location');
    expect(root.textContent).not.toContain('Homey location:');

    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'Amers';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(300);
    const request = TestBed.inject(HttpTestingController).expectOne((r) => r.url === '/api/weather/places');
    expect(request.request.params.get('query')).toBe('Amers');
    request.flush([
      { name: 'Amersfoort', region: 'Utrecht', country: 'Netherlands', latitude: 52.155, longitude: 5.388 },
      { name: 'Amersfoort', region: 'Mpumalanga', country: 'South Africa', latitude: -27.009, longitude: 29.866 },
    ]);
    await vi.runAllTimersAsync();
    fixture.detectChanges();

    const matches = [...root.querySelectorAll<HTMLButtonElement>('.match')];
    expect(matches.map((m) => [m.querySelector('.match__name')?.textContent, m.querySelector('.match__detail')?.textContent])).toEqual([
      ['Amersfoort', 'Utrecht, Netherlands'],
      ['Amersfoort', 'Mpumalanga, South Africa'],
    ]);
    matches[0].click();

    expect(changes).toEqual([
      { target: WEATHER_PLACE, place: { name: 'Amersfoort', latitude: 52.155, longitude: 5.388 }, account: undefined },
    ]);
  });

  it('names the town Homey is in once its forecast has come', async () => {
    realtime.forecastList = [forecast()];
    TestBed.inject(WeatherData);
    await vi.runAllTimersAsync();
    const { root } = await render({ target: WEATHER_HERE, account: 1 });

    expect(root.querySelector('.current span')?.textContent).toBe('Homey location: Utrecht');
  });

  it('goes back to where Homey is', async () => {
    const { root, changes } = await render({ target: WEATHER_PLACE, place: { name: 'Barcelona', latitude: 41.389, longitude: 2.159 } });

    expect(root.textContent).toContain('Barcelona');
    (root.querySelector('.current button') as HTMLButtonElement).click();

    expect(changes).toEqual([{ target: WEATHER_HERE, place: undefined }]);
  });
});

describe('weather helpers', () => {
  it('reads WMO codes by day and night', () => {
    expect(weatherLook(0, true).text).toBe('Clear');
    expect(weatherLook(0, false).icon).not.toBe(weatherLook(0, true).icon);
    expect(weatherLook(95).text).toBe('Thunderstorm');
  });

  it('sums up the rain of the next two hours', () => {
    expect(rainSummary(null, NOW)).toBeNull();
    expect(rainSummary(rain([0, 0, 0]), NOW)).toBeNull();
    expect(rainSummary(rain(Array(25).fill(1)), NOW)).toBe('Rain for 2 hours');
    // The five minutes that hold now count; those before them don't.
    expect(rainSummary(rain([3, 0, 0]), NOW + 6 * 60_000)).toBeNull();
  });

  it('registers one kind that points at the weather where a Homey is', () => {
    expect(WEATHER_TILES.kinds.map((k) => [k.id, k.target, (k.defaultSettings as { target: string }).target])).toEqual([
      ['weather', 'weather', WEATHER_HERE],
    ]);
  });
});
