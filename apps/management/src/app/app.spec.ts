import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardSummary, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { Shell } from './shell';

const dashboard = (id: string, name: string, change: Partial<DashboardSummary> = {}): DashboardSummary => ({
  id,
  name,
  publishedVersion: 1,
  publishedAt: null,
  hasUnpublishedChanges: false,
  missingTiles: 0,
  ...change,
});

describe('Shell', () => {
  let realtime: FakeRealtime;

  async function render(list: DashboardSummary[]) {
    realtime = new FakeRealtime();
    TestBed.configureTestingModule({
      imports: [Shell],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: Realtime, useValue: realtime }],
    });
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    TestBed.inject(HttpTestingController).match('/api/dashboards').forEach((request) => request.flush(list));
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const items = (root: HTMLElement) => [...root.querySelectorAll('a.hd-nav__item[href^="/dashboards"]')];

  it('lists dashboards and marks one with unpublished changes', async () => {
    const root = await render([
      dashboard('1', 'Hallway', { publishedVersion: 2 }),
      dashboard('2', 'Kitchen', { publishedVersion: 0, hasUnpublishedChanges: true }),
    ]);

    expect(items(root).map((i) => i.querySelector('span')?.textContent)).toEqual(['Hallway', 'Kitchen']);
    expect(items(root).map((i) => i.querySelector('.hd-pill')?.textContent ?? null)).toEqual([null, 'Draft']);
  });

  it('flags a dashboard with tiles Homey does not have', async () => {
    const root = await render([dashboard('1', 'Hallway'), dashboard('2', 'Kitchen', { missingTiles: 2 })]);

    expect(items(root).map((i) => i.querySelector('.hd-dot-warn')?.getAttribute('aria-label') ?? null)).toEqual([
      null,
      '2 tiles not found in Homey',
    ]);
  });

  it('follows dashboards changed elsewhere', async () => {
    const root = await render([dashboard('1', 'Hallway')]);

    realtime.push('Dashboards', [dashboard('1', 'Hallway'), dashboard('2', 'Attic')]);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(items(root).map((i) => i.querySelector('span')?.textContent)).toEqual(['Hallway', 'Attic']);
  });
});
