import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DashboardSummary, DashboardVersion, DisplayInfo, DisplayStatus, IdleRule, LockWidget, PhotoSet, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { alwaysRule, RealtimeTileData, TileData } from '@homey-dash/tiles';
import { DashboardsStore } from './dashboards-store';
import { DisplaysPage, timeAgo } from './displays-page';

const status = (change: Partial<DisplayStatus>): DisplayStatus => ({
  connected: false,
  held: true,
  lastSeenAt: null,
  versions: [],
  kiosk: false,
  lux: null,
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
const display = (id: string, name: string, dashboardIds: string[], status: DisplayStatus): DisplayInfo => ({
  id,
  name,
  dashboardIds,
  idleRules: [],
  lockWidgets: [],
  status,
});

describe('DisplaysPage', () => {
  let realtime: FakeRealtime;

  async function render(list: DisplayInfo[], photoSets: PhotoSet[] = []) {
    realtime = new FakeRealtime();
    realtime.displays = list;
    realtime.photoSetList = photoSets;
    TestBed.configureTestingModule({
      imports: [DisplaysPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Realtime, useValue: realtime },
        { provide: TileData, useExisting: RealtimeTileData },
      ],
    });
    TestBed.inject(DashboardsStore).list.set([summary('c', 'Cinema'), summary('g', 'Garden'), summary('k', 'Kitchen'), summary('d', 'Draft', 0)]);
    const fixture = TestBed.createComponent(DisplaysPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const pills = (root: HTMLElement) => [...root.querySelectorAll('.status .hd-pill')].map((p) => p.textContent?.trim());

  it('shows whether each display is connected and on the latest version', async () => {
    const root = await render([
      display('1', 'Hallway', ['k'], status({ connected: true, versions: [version('k', 3, 3)] })),
      display('2', 'Kitchen', ['k'], status({ versions: [version('k', 2, 3)] })),
      display('3', 'Attic', [], status({ held: false })),
      display('4', 'Den', ['k', 'g'], status({ versions: [version('k', 3, 3), version('g', null, 1)] })),
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

  it('shows a connected display running in Fully Kiosk with its light', async () => {
    const root = await render([display('1', 'Hallway', ['k'], status({ connected: true, kiosk: true, lux: 1234, versions: [version('k', 3, 3)] }))]);

    expect(pills(root)).toEqual(['Connected', 'Fully Kiosk', '1,234 lx']);
  });

  describe('dashboards', () => {
    const checks = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>('.dashboards input')];
    const assigned = () => TestBed.inject(HttpTestingController).expectOne('/api/displays/1/dashboards').request.body;

    it('lists the ones it offers in order, then the other published ones', async () => {
      const root = await render([display('1', 'Hallway', ['k', 'g'], status({}))]);

      expect([...root.querySelectorAll('.dashboards .hd-check')].map((c) => c.textContent?.trim())).toEqual(['Kitchen', 'Garden', 'Cinema']);
      expect(checks(root).map((c) => c.checked)).toEqual([true, true, false]);
    });

    it('offers a checked one last, and stops offering an unchecked one', async () => {
      const root = await render([display('1', 'Hallway', ['k', 'g'], status({}))]);

      checks(root)[2].click();
      expect(assigned()).toEqual({ dashboardIds: ['k', 'g', 'c'] });

      checks(root)[0].click();
      expect(assigned()).toEqual({ dashboardIds: ['g'] });
    });

    it('reorders them', async () => {
      const root = await render([display('1', 'Hallway', ['k', 'g'], status({}))]);

      (root.querySelector('[aria-label="Move Garden up"]') as HTMLButtonElement).click();

      expect(assigned()).toEqual({ dashboardIds: ['g', 'k'] });
    });
  });

  describe('idle rules', () => {
    const weekend: IdleRule = {
      dashboardId: 'g',
      rule: { match: 'all', conditions: [{ signal: 'clock:now', operator: 'onWeekdays', value: ['saturday', 'sunday'] }] },
    };
    const idleRequest = () => TestBed.inject(HttpTestingController).expectOne('/api/displays/1/idle-rules').request;

    it('adds a rule that always holds on its first dashboard, and opens it', async () => {
      const root = await render([display('1', 'Hallway', ['k', 'g'], status({}))]);

      (root.querySelector('.idle__add') as HTMLButtonElement).click();
      await TestBed.inject(ApplicationRef).whenStable();

      expect(idleRequest().body.rules).toEqual([{ dashboardId: 'k', rule: alwaysRule() }]);
      expect(root.querySelector('.idle hd-rule-editor')).not.toBeNull();
    });

    it('picks its dashboard from those the display offers, in order', async () => {
      const root = await render([{ ...display('1', 'Hallway', ['k', 'g', 'c'], status({})), idleRules: [weekend] }]);
      const select = root.querySelector('.idle__entry select') as HTMLSelectElement;

      expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['Kitchen', 'Garden', 'Cinema', 'Colour', 'Turn screen off']);
      select.value = 'dashboard:c';
      select.dispatchEvent(new Event('change'));

      expect(idleRequest().body.rules).toEqual([{ ...weekend, dashboardId: 'c', photoSetId: null, color: null, screenOff: false, returnDashboardId: null }]);
    });

    it('plays a photo set instead, going back to the last used or a dashboard it offers', async () => {
      const summer = { id: 's', name: 'Summer', target: 'photo-set:s', photos: [] } as unknown as PhotoSet;
      const root = await render([{ ...display('1', 'Hallway', ['k', 'g'], status({})), idleRules: [weekend] }], [summer]);
      const selects = () => [...root.querySelectorAll<HTMLSelectElement>('.idle__entry select')];

      selects()[0].value = 'photos:s';
      selects()[0].dispatchEvent(new Event('change'));
      expect(idleRequest().body.rules).toEqual([{ ...weekend, dashboardId: null, photoSetId: 's', color: null, screenOff: false, returnDashboardId: null }]);
      await TestBed.inject(ApplicationRef).whenStable();

      const back = selects()[1];
      expect([...back.options].map((o) => o.textContent?.trim())).toEqual(['Back to the last used', 'Back to Kitchen', 'Back to Garden']);
      back.value = 'g';
      back.dispatchEvent(new Event('change'));
      expect(idleRequest().body.rules).toEqual([{ ...weekend, dashboardId: null, photoSetId: 's', color: null, screenOff: false, returnDashboardId: 'g' }]);
    });

    it('fills with a colour instead, starting black, going back to the last used or a dashboard it offers', async () => {
      const root = await render([{ ...display('1', 'Hallway', ['k', 'g'], status({})), idleRules: [weekend] }]);
      const action = root.querySelector('.idle__entry select') as HTMLSelectElement;

      action.value = 'color';
      action.dispatchEvent(new Event('change'));
      expect(idleRequest().body.rules).toEqual([{ ...weekend, dashboardId: null, photoSetId: null, color: '#000000', screenOff: false, returnDashboardId: null }]);
      await TestBed.inject(ApplicationRef).whenStable();

      const color = root.querySelector('.idle__color') as HTMLInputElement;
      expect(color.value).toBe('#000000');
      color.value = '#203040';
      color.dispatchEvent(new Event('change'));
      expect(idleRequest().body.rules[0].color).toBe('#203040');
      await TestBed.inject(ApplicationRef).whenStable();

      const back = root.querySelectorAll<HTMLSelectElement>('.idle__entry select')[1];
      back.value = 'g';
      back.dispatchEvent(new Event('change'));
      expect(idleRequest().body.rules[0]).toEqual({ ...weekend, dashboardId: null, photoSetId: null, color: '#203040', screenOff: false, returnDashboardId: 'g' });
    });

    it('turns the screen off instead, going back to the last used', async () => {
      const root = await render([{ ...display('1', 'Hallway', ['k', 'g'], status({})), idleRules: [weekend] }]);
      const action = root.querySelector('.idle__entry select') as HTMLSelectElement;

      action.value = 'screen-off';
      action.dispatchEvent(new Event('change'));

      expect(idleRequest().body.rules).toEqual([
        { ...weekend, dashboardId: null, photoSetId: null, color: null, screenOff: true, returnDashboardId: null },
      ]);
    });

    it('reorders and removes rules', async () => {
      const cinema = { ...weekend, dashboardId: 'c' };
      const root = await render([{ ...display('1', 'Hallway', ['k', 'g', 'c'], status({})), idleRules: [weekend, cinema] }]);

      (root.querySelector('[aria-label="Move rule 2 up"]') as HTMLButtonElement).click();
      expect(idleRequest().body.rules).toEqual([cinema, weekend]);
      await TestBed.inject(ApplicationRef).whenStable();

      (root.querySelector('[aria-label="Remove rule 1"]') as HTMLButtonElement).click();
      expect(idleRequest().body.rules).toEqual([weekend]);
    });
  });

  describe('lock screen', () => {
    const lockRequest = () => TestBed.inject(HttpTestingController).expectOne('/api/displays/1/lock-screen').request;
    const stable = () => TestBed.inject(ApplicationRef).whenStable();

    it('adds a clock in the middle first, then the weather', async () => {
      const root = await render([display('1', 'Hallway', ['k'], status({}))]);

      (root.querySelector('.lock__add') as HTMLButtonElement).click();
      expect(lockRequest().body.widgets).toEqual([{ kind: 'clock', spot: 'center' }]);
      await stable();

      (root.querySelector('.lock__add') as HTMLButtonElement).click();
      expect(lockRequest().body.widgets).toEqual([{ kind: 'clock', spot: 'center' }, { kind: 'weather', spot: 'top-right' }]);
    });

    it('moves a widget to another place, and removes it', async () => {
      const lockWidgets: LockWidget[] = [{ kind: 'clock', spot: 'center' }, { kind: 'weather', spot: 'top-right' }];
      const root = await render([{ ...display('1', 'Hallway', ['k'], status({})), lockWidgets }]);
      const where = root.querySelector('[aria-label="Where widget 2 sits"]') as HTMLSelectElement;

      expect([...where.options].map((o) => o.textContent?.trim())).toEqual(['Top left', 'Top right', 'Middle', 'Bottom left', 'Bottom right']);
      where.value = 'bottom-left';
      where.dispatchEvent(new Event('change'));
      expect(lockRequest().body.widgets).toEqual([{ kind: 'clock', spot: 'center' }, { kind: 'weather', spot: 'bottom-left' }]);
      await stable();

      (root.querySelector('[aria-label="Remove widget 1"]') as HTMLButtonElement).click();
      expect(lockRequest().body.widgets).toEqual([{ kind: 'weather', spot: 'bottom-left' }]);
    });

    it('shows a device value, starting on a temperature, picked from capability signals', async () => {
      const root = await render([{ ...display('1', 'Hallway', ['k'], status({})), lockWidgets: [{ kind: 'clock', spot: 'bottom-right' }] }]);
      const signal = (id: string, name: string) => ({ id, source: 'homey', type: 'number', name, group: 'Thermostat', account: 1 });
      TestBed.inject(HttpTestingController)
        .match('/api/rules/signals')
        .forEach((r) => r.flush([signal('homey:1:capability:th:onoff', 'Turned on'), signal('homey:1:capability:th:measure_temperature', 'Temperature'), signal('homey:1:variable:v', 'Guests')]));
      await stable();
      const kind = root.querySelector('[aria-label="What widget 1 shows"]') as HTMLSelectElement;

      kind.value = 'value';
      kind.dispatchEvent(new Event('change'));

      expect(lockRequest().body.widgets).toEqual([{ kind: 'value', spot: 'bottom-right', signal: 'homey:1:capability:th:measure_temperature' }]);
      await stable();
      expect(root.querySelector('.lock hd-signal-picker')?.textContent).toContain('Thermostat — Temperature');
    });
  });

  it('follows status pushed over the realtime connection', async () => {
    const root = await render([display('1', 'Hallway', [], status({}))]);

    realtime.push('Displays', [display('1', 'Hallway', [], status({ connected: true }))]);
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
