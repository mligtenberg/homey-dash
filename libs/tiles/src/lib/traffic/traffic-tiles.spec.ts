import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Realtime, RouteTraffic } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { TileSize } from '@homey-dash/layout';
import { RealtimeTileData } from '../realtime-tile-data';
import { TileData } from '../tile-data';
import { delayLevel, delayText, distance, duration, TrafficData } from './traffic-data';
import { TrafficRouteField } from './traffic-route-field';
import { TrafficTile } from './traffic-tile';
import { TRAFFIC_TILES } from './traffic-tiles';

const route = {
  name: 'Home to work',
  origin: { name: 'Home', latitude: 52.089, longitude: 5.11 },
  destination: { name: 'Work', latitude: 52.379, longitude: 4.9 },
};
const KEY = '52.089,5.110>52.379,4.900';

const traffic = (change: Partial<RouteTraffic> = {}): RouteTraffic => ({
  routeKey: KEY,
  status: 'connected',
  error: null,
  travelSeconds: 1500,
  usualSeconds: 1080,
  delaySeconds: 420,
  distanceMeters: 21_400,
  arrival: '2026-11-08T17:55:00+01:00',
  updatedAt: '2026-11-08T17:30:00+01:00',
  ...change,
});

describe('Traffic tile', () => {
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

  async function render(size: TileSize = 'wide', settings: Record<string, unknown> = { target: null, route }) {
    TestBed.inject(TrafficData); // Connects, so pushes reach it.
    await settle();
    const fixture = TestBed.createComponent(TrafficTile);
    fixture.componentRef.setInput('settings', settings);
    fixture.componentRef.setInput('size', size);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  it('is a kind of its own that points at nothing in Homey', () => {
    expect(TRAFFIC_TILES.kinds.map((k) => [k.id, k.target])).toEqual([['traffic', 'none']]);
  });

  it('shows the travel time and the delay on a small tile, coloured by the delay', async () => {
    realtime.trafficList = [traffic()];

    const tile = await render('small');

    expect(tile.classList).toContain('has-traffic');
    expect(tile.getAttribute('data-kind')).toBe('heat');
    expect(tile.querySelector('.hd-value')?.textContent).toBe('25 min');
    expect(tile.querySelector('.hd-tile__name')?.textContent).toBe('Home to work');
    expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('+7 min');
    expect(tile.querySelector('.hd-traffic__figures')).toBeNull();
  });

  it('is amber with a small delay, and blue and on time without one', async () => {
    realtime.trafficList = [traffic({ delaySeconds: 200 })];
    expect((await render('small')).getAttribute('data-kind')).toBe('light');

    realtime.push('Traffic', [traffic({ delaySeconds: 30 })]);
    await settle();
    const tile = await render('small');
    expect(tile.getAttribute('data-kind')).toBe('climate');
    expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('On time');
  });

  it('adds the distance and arrival from wide, and the usual time from large', async () => {
    realtime.trafficList = [traffic()];

    const wide = await render('wide');
    expect([...wide.querySelectorAll('.hd-traffic__label')].map((l) => l.textContent)).toEqual(['Distance', 'Arrive', 'Updated']);
    expect(wide.querySelector('.hd-traffic__value')?.textContent).toBe('21 km');

    const large = await render('large');
    expect([...large.querySelectorAll('.hd-traffic__label')].map((l) => l.textContent)).toEqual(['Distance', 'Arrive', 'Usual', 'Updated']);
    expect(large.querySelectorAll('.hd-traffic__value')[2].textContent).toBe('18 min');
  });

  it('follows the traffic as it changes', async () => {
    realtime.trafficList = [traffic()];
    const tile = await render('small');

    realtime.push('Traffic', [traffic({ travelSeconds: 3900, delaySeconds: 2820 })]);
    await settle();

    expect(tile.querySelector('.hd-value')?.textContent).toBe('1 h 05 min');
  });

  it('asks to pick a route, or says it is loading', async () => {
    const unset = await render('small', { target: null });
    expect(unset.classList).toContain('hd-tile');
    expect(unset.querySelector('.hd-tile__detail')?.textContent).toBe('Pick a route');

    realtime.trafficList = [];
    const loading = await render('small');
    expect(loading.querySelector('.hd-tile__detail')?.textContent).toBe('…');
  });

  it('says TomTom is not set up, without crashing', async () => {
    realtime.trafficList = [traffic({ status: 'noAccount', travelSeconds: null, usualSeconds: null, delaySeconds: null, distanceMeters: null, arrival: null, updatedAt: null })];

    const tile = await render('wide');

    expect(tile.classList).toContain('is-unavailable');
    expect(tile.classList).not.toContain('has-traffic');
    expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('Set up TomTom in Management');
  });

  it('keeps the last time, dimmed, while TomTom cannot be reached', async () => {
    realtime.trafficList = [traffic({ status: 'disconnected', error: 'Cannot reach TomTom.' })];

    const tile = await render('wide');

    expect(tile.classList).toContain('is-unavailable');
    expect(tile.querySelector('.hd-value')?.textContent).toBe('25 min');
    expect(tile.querySelector('.hd-tile__detail')?.textContent).toBe('+7 min · Cannot reach TomTom.');
    expect([...tile.querySelectorAll('.hd-traffic__label')].map((l) => l.textContent)).toContain('Out of date');
  });

  it('is named by its label before its route', async () => {
    realtime.trafficList = [traffic()];

    const tile = await render('small', { target: null, route, label: 'Commute' });

    expect(tile.querySelector('.hd-tile__name')?.textContent).toBe('Commute');
  });

  describe('figures', () => {
    it('round to the minute, and name an hour', () => {
      expect([duration(20), duration(1500), duration(3600), duration(3900)]).toEqual(['1 min', '25 min', '1 h 00 min', '1 h 05 min']);
      expect([distance(850), distance(4_240), distance(21_400)]).toEqual(['850 m', '4.2 km', '21 km']);
    });

    it('say a delay once it is worth a mention', () => {
      expect([delayLevel(60, 1000), delayLevel(150, 1000), delayLevel(400, 1000), delayLevel(400, 3000), delayLevel(900, 3000)]).toEqual([
        'none',
        'some',
        'heavy',
        'some',
        'heavy',
      ]);
      expect([delayText(30, 1000), delayText(420, 1080)]).toEqual(['On time', '+7 min']);
    });
  });
});

describe('Traffic route field', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Realtime, useValue: new FakeRealtime() }] });
  });

  function render(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(TrafficRouteField);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    const emitted: unknown[] = [];
    fixture.componentInstance.changed.subscribe((r) => emitted.push(r));
    fixture.detectChanges();
    return { fixture, emitted, element: fixture.nativeElement as HTMLElement };
  }

  it('searches places with the account, and shows the matches with their region', async () => {
    vi.useFakeTimers();
    const { fixture, element } = render({ account: 2 });
    const input = element.querySelector('#route-origin') as HTMLInputElement;

    input.value = 'Utr';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(400);

    const request = TestBed.inject(HttpTestingController).expectOne((r) => r.url === '/api/traffic/places');
    expect(request.request.params.get('query')).toBe('Utr');
    expect(request.request.params.get('account')).toBe('2');
    request.flush([{ name: 'Utrecht Centraal', region: 'Utrecht', country: 'Netherlands', latitude: 52.089, longitude: 5.11 }]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('.match__detail')?.textContent).toBe('Utrecht, Netherlands');
    vi.useRealTimers();
  });

  it('emits the route once both places are chosen, named after them until it has a name', async () => {
    const { fixture, emitted, element } = render();
    const [origin, destination] = [...element.querySelectorAll('hd-traffic-place-field')].map((e) => (e as HTMLElement & { __ngContext__?: unknown }));
    expect(origin).toBeDefined();
    expect(destination).toBeDefined();
    const field = fixture.componentInstance as unknown as { pick(end: 'origin' | 'destination', place: unknown): void };

    field.pick('origin', route.origin);
    expect(emitted).toEqual([]);
    field.pick('destination', route.destination);

    expect(emitted).toEqual([{ name: 'Home → Work', origin: route.origin, destination: route.destination }]);
  });

  it('keeps a name that was typed when a place changes', () => {
    const { fixture, emitted } = render({ route });
    const field = fixture.componentInstance as unknown as { pick(end: 'origin' | 'destination', place: unknown): void };

    field.pick('destination', { name: 'Schiphol', latitude: 52.309, longitude: 4.764 });

    expect(emitted).toEqual([{ name: 'Home to work', origin: route.origin, destination: { name: 'Schiphol', latitude: 52.309, longitude: 4.764 } }]);
  });
});
