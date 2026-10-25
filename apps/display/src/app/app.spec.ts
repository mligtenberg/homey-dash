import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Realtime, ScreenView } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { App } from './app';

const hallway = { id: 'd1', name: 'Hallway', dashboardId: null };
const published = (version: number): ScreenView => ({
  display: { ...hallway, dashboardId: 'k1' },
  dashboard: { id: 'k1', name: 'Kitchen', version, layout: { rows: 4, sections: [] } },
});

describe('App', () => {
  let realtime: FakeRealtime;

  beforeEach(() => {
    localStorage.clear();
    realtime = new FakeRealtime();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Realtime, useValue: realtime }],
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
    const root = await start({ display: hallway, dashboard: null });

    expect(root.querySelector('h1')?.textContent).toBe('Hallway');
    expect(root.querySelector('.hd-pill')?.textContent).toBe('Waiting for a dashboard');
    expect(realtime.shown).toEqual([null]);
  });

  it('switches to a newly published version and reports it once it is on screen', async () => {
    const onScreen: boolean[] = [];
    realtime.onShowing = () => onScreen.push(document.querySelector('hd-dashboard-view') !== null);
    await start({ display: hallway, dashboard: null });

    realtime.push('Screen', published(2));
    await stable();

    expect(realtime.shown).toEqual([null, 2]);
    expect(onScreen).toEqual([false, true]);
  });

  it('reports what it shows again after a reconnect', async () => {
    await start(published(1));

    realtime.connected.set(false);
    realtime.reconnect();
    await stable();

    expect(realtime.shown).toEqual([1, 1]);
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

  it('shows connection lost when HomeyDash cannot reach Homey', async () => {
    const root = await start(published(1));

    realtime.push('HomeyStatus', { connection: 'disconnected', lastError: 'timeout', since: '', fake: false });
    await stable();

    expect(root.classList).toContain('is-connection-lost');
  });
});
