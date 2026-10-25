import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  async function start(answer: (http: HttpTestingController, screen: string) => void) {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    const screen = localStorage.getItem('homeydash.screen') ?? '';
    answer(http, screen);
    await fixture.whenStable();
    return { root: fixture.nativeElement as HTMLElement, http, screen };
  }

  it('keeps one screen id across loads', async () => {
    const { screen } = await start(() => undefined);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting()] });
    TestBed.createComponent(App);

    expect(screen).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    TestBed.inject(HttpTestingController).expectOne(`/api/screens/${screen}`);
  });

  it('runs setup on a screen that is not a display', async () => {
    const { root, http } = await start((http, screen) =>
      http.expectOne(`/api/screens/${screen}`).flush(null, { status: 404, statusText: 'Not Found' }),
    );
    http.expectOne('/api/displays').flush([{ id: 'd1', name: 'Kitchen wall', dashboardId: null }]);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(root.querySelector('h1')?.textContent).toBe('Set up this screen');
    expect(root.querySelector('li .name')?.textContent).toBe('Kitchen wall');
  });

  it('waits when no dashboard is assigned', async () => {
    const { root } = await start((http, screen) =>
      http.expectOne(`/api/screens/${screen}`).flush({ display: { id: 'd1', name: 'Hallway', dashboardId: null }, dashboard: null }),
    );

    expect(root.querySelector('h1')?.textContent).toBe('Hallway');
    expect(root.querySelector('.hd-pill')?.textContent).toBe('Waiting for a dashboard');
  });

  it('keeps the last state and shows reconnecting when HomeyDash cannot be reached', async () => {
    const { root } = await start((http, screen) =>
      http.expectOne(`/api/screens/${screen}`).flush(null, { status: 0, statusText: 'Unknown Error' }),
    );

    expect(root.classList).toContain('is-connection-lost');
    expect(root.querySelector('.hd-reconnecting')).not.toBeNull();
  });
});
