import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DashboardSummary, DashboardVersion, DisplayInfo, DisplayStatus, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { DashboardsStore } from './dashboards-store';
import { DisplaysPage, timeAgo } from './displays-page';

const status = (change: Partial<DisplayStatus>): DisplayStatus => ({
  connected: false,
  held: true,
  lastSeenAt: null,
  versions: [],
  ...change,
});

const summary = (id: string, name: string, publishedVersion = 1): DashboardSummary => ({
  id,
  name,
  publishedVersion,
  publishedAt: null,
  hasUnpublishedChanges: false,
  missingTiles: 0,
});
const version = (dashboardId: string, shownVersion: number | null, latestVersion: number): DashboardVersion => ({
  dashboardId,
  shownVersion,
  latestVersion,
});
const display = (id: string, name: string, dashboardId: string | null, otherDashboardIds: string[], status: DisplayStatus): DisplayInfo => ({
  id,
  name,
  dashboardId,
  otherDashboardIds,
  status,
});

describe('DisplaysPage', () => {
  let realtime: FakeRealtime;

  async function render(list: DisplayInfo[]) {
    realtime = new FakeRealtime();
    realtime.displays = list;
    TestBed.configureTestingModule({
      imports: [DisplaysPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Realtime, useValue: realtime }],
    });
    TestBed.inject(DashboardsStore).list.set([summary('c', 'Cinema'), summary('g', 'Garden'), summary('k', 'Kitchen'), summary('d', 'Draft', 0)]);
    const fixture = TestBed.createComponent(DisplaysPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const pills = (root: HTMLElement) => [...root.querySelectorAll('.status .hd-pill')].map((p) => p.textContent?.trim());

  it('shows whether each display is connected and on the latest version', async () => {
    const root = await render([
      display('1', 'Hallway', 'k', [], status({ connected: true, versions: [version('k', 3, 3)] })),
      display('2', 'Kitchen', 'k', [], status({ versions: [version('k', 2, 3)] })),
      display('3', 'Attic', null, [], status({ held: false })),
      display('4', 'Den', 'k', ['g'], status({ versions: [version('k', 3, 3), version('g', null, 1)] })),
    ]);

    expect(pills(root)).toEqual([
      'Connected',
      'Never connected',
      'Shows version 2 of 3',
      'No screen',
      'Waiting for a dashboard',
      'Never connected',
      'Garden: not showing it yet',
    ]);
  });

  it('offers the other published dashboards on the tape, in list order', async () => {
    const root = await render([display('1', 'Hallway', 'k', ['g'], status({}))]);
    const checks = [...root.querySelectorAll<HTMLInputElement>('.others input')];

    expect([...root.querySelectorAll('.others .hd-check')].map((c) => c.textContent?.trim())).toEqual(['Cinema', 'Garden']);
    expect(checks.map((c) => c.checked)).toEqual([false, true]);

    checks[0].click();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/displays/1/dashboard').request;
    expect(request.body).toEqual({ dashboardId: 'k', otherDashboardIds: ['c', 'g'] });
  });

  it('drops the others when the main dashboard goes', async () => {
    const root = await render([display('1', 'Hallway', 'k', ['g'], status({}))]);
    const select = root.querySelector('select') as HTMLSelectElement;

    select.value = '';
    select.dispatchEvent(new Event('change'));

    const request = TestBed.inject(HttpTestingController).expectOne('/api/displays/1/dashboard').request;
    expect(request.body).toEqual({ dashboardId: null, otherDashboardIds: [] });
  });

  it('follows status pushed over the realtime connection', async () => {
    const root = await render([display('1', 'Hallway', null, [], status({}))]);

    realtime.push('Displays', [display('1', 'Hallway', null, [], status({ connected: true }))]);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(pills(root)[0]).toBe('Connected');
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');

  it('rounds to minutes and hours', () => {
    expect(timeAgo('2026-10-25T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-25T11:15:00Z', now)).toBe('45 min ago');
    expect(timeAgo('2026-10-25T07:00:00Z', now)).toBe('5 h ago');
  });
});
