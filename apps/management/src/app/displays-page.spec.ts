import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DisplayInfo, DisplayStatus, Realtime, RealtimeMessages } from '@homey-dash/api-client';
import { DisplaysPage, timeAgo } from './displays-page';

const status = (change: Partial<DisplayStatus>): DisplayStatus => ({
  connected: false,
  held: true,
  lastSeenAt: null,
  shownVersion: null,
  latestVersion: null,
  ...change,
});

describe('DisplaysPage', () => {
  let push: (list: DisplayInfo[]) => void = () => undefined;

  async function render(list: DisplayInfo[]) {
    const realtime: Partial<Realtime> = {
      whenConnected: (join) => (join(), () => true),
      on: <K extends keyof RealtimeMessages>(_: K, handler: (message: RealtimeMessages[K]) => void) => {
        push = handler as (list: DisplayInfo[]) => void;
        return () => undefined;
      },
      joinManagement: async () => list,
    };
    TestBed.configureTestingModule({
      imports: [DisplaysPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Realtime, useValue: realtime }],
    });
    const fixture = TestBed.createComponent(DisplaysPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const pills = (root: HTMLElement) => [...root.querySelectorAll('.status .hd-pill')].map((p) => p.textContent?.trim());

  it('shows whether each display is connected and on the latest version', async () => {
    const root = await render([
      { id: '1', name: 'Hallway', dashboardId: 'k', status: status({ connected: true, shownVersion: 3, latestVersion: 3 }) },
      { id: '2', name: 'Kitchen', dashboardId: 'k', status: status({ shownVersion: 2, latestVersion: 3 }) },
      { id: '3', name: 'Attic', dashboardId: null, status: status({ held: false }) },
    ]);

    expect(pills(root)).toEqual(['Connected', 'Never connected', 'Shows version 2 of 3', 'No screen', 'Waiting for a dashboard']);
  });

  it('follows status pushed over the realtime connection', async () => {
    const root = await render([{ id: '1', name: 'Hallway', dashboardId: null, status: status({}) }]);

    push([{ id: '1', name: 'Hallway', dashboardId: null, status: status({ connected: true }) }]);
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
