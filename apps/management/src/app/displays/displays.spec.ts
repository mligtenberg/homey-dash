import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ScreenDetails, DashboardSummary, DashboardVersion, DisplayInfo, DisplayStatus, IdleRule, LockWidget, PhotoSet, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { alwaysRule, RealtimeTileData, TileData } from '@homey-dash/tiles';
import { DashboardsStore } from '../dashboards-store';
import { appRoutes } from '../app.routes';
import { timeAgo } from '@homey-dash/design-system';

const status = (change: Partial<DisplayStatus>): DisplayStatus => ({
  connected: false,
  held: true,
  lastSeenAt: null,
  versions: [],
  kiosk: false,
  lux: null,
  details: null,
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

describe('Displays', () => {
  let realtime: FakeRealtime;

  // Opens a page of the first display, or the overview when no tab is given.
  async function render(list: DisplayInfo[], photoSets: PhotoSet[] = [], url = '/displays/1/dashboards') {
    realtime = new FakeRealtime();
    realtime.displays = list;
    realtime.photoSetList = photoSets;
    TestBed.configureTestingModule({
      providers: [
        provideRouter(appRoutes),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Realtime, useValue: realtime },
        { provide: TileData, useExisting: RealtimeTileData },
      ],
    });
    TestBed.inject(DashboardsStore).list.set([summary('c', 'Cinema'), summary('g', 'Garden'), summary('k', 'Kitchen'), summary('d', 'Draft', 0)]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await TestBed.inject(ApplicationRef).whenStable();
    return harness.routeNativeElement as HTMLElement;
  }

  const pills = (root: HTMLElement) => [...root.querySelectorAll('.status .hd-pill')].map((p) => p.textContent?.trim());

  it('shows whether each display is connected and on the latest version', async () => {
    const root = await render([
      display('1', 'Hallway', ['k'], status({ connected: true, versions: [version('k', 3, 3)] })),
      display('2', 'Kitchen', ['k'], status({ versions: [version('k', 2, 3)] })),
      display('3', 'Attic', [], status({ held: false })),
      display('4', 'Den', ['k', 'g'], status({ versions: [version('k', 3, 3), version('g', null, 1)] })),
    ], [], '/displays');

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
    const root = await render([display('1', 'Hallway', ['k'], status({ connected: true, kiosk: true, lux: 1234, versions: [version('k', 3, 3)] }))], [], '/displays');

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
      const root = await render([display('1', 'Hallway', ['k', 'g'], status({}))], [], '/displays/1/idle');

      (root.querySelector('.idle-add') as HTMLButtonElement).click();
      await TestBed.inject(ApplicationRef).whenStable();

      expect(idleRequest().body.rules).toEqual([{ dashboardId: 'k', rule: alwaysRule() }]);
      expect(root.querySelector('hd-rule-editor')).not.toBeNull();
    });

    it('picks its dashboard from those the display offers, in order', async () => {
      const root = await render([{ ...display('1', 'Hallway', ['k', 'g', 'c'], status({})), idleRules: [weekend] }], [], '/displays/1/idle');
      const select = root.querySelector('.entry select') as HTMLSelectElement;

      expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['Kitchen', 'Garden', 'Cinema', 'Colour', 'Turn screen off (Fully Kiosk Browser only)']);
      select.value = 'dashboard:c';
      select.dispatchEvent(new Event('change'));

      expect(idleRequest().body.rules).toEqual([{ ...weekend, dashboardId: 'c', photoSetId: null, color: null, screenOff: false, returnDashboardId: null }]);
    });

    it('plays a photo set instead, going back to the last used or a dashboard it offers', async () => {
      const summer = { id: 's', name: 'Summer', target: 'photo-set:s', photos: [] } as unknown as PhotoSet;
      const root = await render([{ ...display('1', 'Hallway', ['k', 'g'], status({})), idleRules: [weekend] }], [summer], '/displays/1/idle');
      const selects = () => [...root.querySelectorAll<HTMLSelectElement>('.entry select')];

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
      const root = await render([{ ...display('1', 'Hallway', ['k', 'g'], status({})), idleRules: [weekend] }], [], '/displays/1/idle');
      const action = root.querySelector('.entry select') as HTMLSelectElement;

      action.value = 'color';
      action.dispatchEvent(new Event('change'));
      expect(idleRequest().body.rules).toEqual([{ ...weekend, dashboardId: null, photoSetId: null, color: '#000000', screenOff: false, returnDashboardId: null }]);
      await TestBed.inject(ApplicationRef).whenStable();

      const color = root.querySelector('.color') as HTMLInputElement;
      expect(color.value).toBe('#000000');
      color.value = '#203040';
      color.dispatchEvent(new Event('change'));
      expect(idleRequest().body.rules[0].color).toBe('#203040');
      await TestBed.inject(ApplicationRef).whenStable();

      const back = root.querySelectorAll<HTMLSelectElement>('.entry select')[1];
      back.value = 'g';
      back.dispatchEvent(new Event('change'));
      expect(idleRequest().body.rules[0]).toEqual({ ...weekend, dashboardId: null, photoSetId: null, color: '#203040', screenOff: false, returnDashboardId: 'g' });
    });

    it('only offers turning the screen off on a screen in Fully Kiosk Browser', async () => {
      const off = (kiosk: boolean) => render([{ ...display('1', 'Hallway', ['k'], status({ kiosk })), idleRules: [weekend] }], [], '/displays/1/idle')
        .then((root) => [...root.querySelectorAll<HTMLOptionElement>('.entry select option')].find((o) => o.value === 'screen-off')!);

      expect((await off(false)).disabled).toBe(true);
      TestBed.resetTestingModule();
      expect((await off(true)).disabled).toBe(false);
    });

    it('turns the screen off instead, going back to the last used', async () => {
      const root = await render([{ ...display('1', 'Hallway', ['k', 'g'], status({ kiosk: true })), idleRules: [weekend] }], [], '/displays/1/idle');
      const action = root.querySelector('.entry select') as HTMLSelectElement;

      action.value = 'screen-off';
      action.dispatchEvent(new Event('change'));

      expect(idleRequest().body.rules).toEqual([
        { ...weekend, dashboardId: null, photoSetId: null, color: null, screenOff: true, returnDashboardId: null },
      ]);
    });

    it('reorders and removes rules', async () => {
      const cinema = { ...weekend, dashboardId: 'c' };
      const root = await render([{ ...display('1', 'Hallway', ['k', 'g', 'c'], status({})), idleRules: [weekend, cinema] }], [], '/displays/1/idle');

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
      const root = await render([display('1', 'Hallway', ['k'], status({}))], [], '/displays/1/lock');

      (root.querySelector('.lock__add') as HTMLButtonElement).click();
      expect(lockRequest().body.widgets).toEqual([{ kind: 'clock', spot: 'center' }]);
      await stable();

      (root.querySelector('.lock__add') as HTMLButtonElement).click();
      expect(lockRequest().body.widgets).toEqual([{ kind: 'clock', spot: 'center' }, { kind: 'weather', spot: 'top-right' }]);
    });

    it('moves a widget to another place, and removes it', async () => {
      const lockWidgets: LockWidget[] = [{ kind: 'clock', spot: 'center' }, { kind: 'weather', spot: 'top-right' }];
      const root = await render([{ ...display('1', 'Hallway', ['k'], status({})), lockWidgets }], [], '/displays/1/lock');
      const where = root.querySelector('[aria-label="Where widget 2 sits"]') as HTMLSelectElement;

      expect([...where.options].map((o) => o.textContent?.trim())).toEqual(['Top left', 'Top right', 'Middle', 'Bottom left', 'Bottom right']);
      where.value = 'bottom-left';
      where.dispatchEvent(new Event('change'));
      expect(lockRequest().body.widgets).toEqual([{ kind: 'clock', spot: 'center' }, { kind: 'weather', spot: 'bottom-left' }]);
      await stable();

      (root.querySelector('[aria-label="Remove widget 1"]') as HTMLButtonElement).click();
      expect(lockRequest().body.widgets).toEqual([{ kind: 'weather', spot: 'bottom-left' }]);
    });

    it('shows a widget always, never or while a rule holds, keeping the rule it had', async () => {
      const root = await render([{ ...display('1', 'Hallway', ['k'], status({})), lockWidgets: [{ kind: 'clock', spot: 'center' }] }], [], '/displays/1/lock');
      const visibility = () => root.querySelector('[aria-label="When widget 1 shows"]') as HTMLSelectElement;
      const choose = (value: string) => {
        visibility().value = value;
        visibility().dispatchEvent(new Event('change'));
      };

      choose('rule');
      const { rule, ...bare } = lockRequest().body.widgets[0];
      expect(bare).toEqual({ kind: 'clock', spot: 'center' });
      expect(rule.conditions.length).toBeGreaterThan(0);
      await stable();
      expect(root.querySelector('.lock hd-rule-editor')).not.toBeNull();

      choose('never');
      expect(lockRequest().body.widgets).toEqual([{ kind: 'clock', spot: 'center', hidden: true }]);
      await stable();
      expect(root.querySelector('.lock hd-rule-editor')).toBeNull();

      choose('always');
      expect(lockRequest().body.widgets).toEqual([{ kind: 'clock', spot: 'center' }]);
    });

    it('adds a traffic widget that has nothing to show until a route is chosen', async () => {
      const root = await render([{ ...display('1', 'Hallway', ['k'], status({})), lockWidgets: [{ kind: 'clock', spot: 'bottom-right' }] }], [], '/displays/1/lock');
      const kind = root.querySelector('[aria-label="What widget 1 shows"]') as HTMLSelectElement;

      kind.value = 'traffic';
      kind.dispatchEvent(new Event('change'));

      expect(lockRequest().body.widgets).toEqual([{ kind: 'traffic', spot: 'bottom-right' }]);
      await stable();
      expect(root.querySelector('.lock hd-traffic-route-field')).not.toBeNull();
    });

    it('keeps when a widget shows as it turns into traffic and back', async () => {
      const rule = alwaysRule();
      const root = await render([{ ...display('1', 'Hallway', ['k'], status({})), lockWidgets: [{ kind: 'clock', spot: 'center', rule }] }], [], '/displays/1/lock');
      const kind = () => root.querySelector('[aria-label="What widget 1 shows"]') as HTMLSelectElement;

      kind().value = 'traffic';
      kind().dispatchEvent(new Event('change'));
      expect(lockRequest().body.widgets).toEqual([{ kind: 'traffic', spot: 'center', rule }]);
      await stable();

      kind().value = 'weather';
      kind().dispatchEvent(new Event('change'));
      expect(lockRequest().body.widgets).toEqual([{ kind: 'weather', spot: 'center', rule }]);
    });

    it('lets a traffic widget pick its TomTom account once there are several, and searches with it', async () => {
      const lockWidgets: LockWidget[] = [{ kind: 'traffic', spot: 'center' }];
      const root = await render([{ ...display('1', 'Hallway', ['k'], status({})), lockWidgets }], [], '/displays/1/lock');
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('/api/accounts/tomtom').flush({ fake: false, accounts: [{ id: 1, name: 'Home' }, { id: 4, name: 'Work' }] });
      await stable();
      const account = root.querySelector('[aria-label="Which TomTom account widget 1 asks"]') as HTMLSelectElement;

      expect([...account.options].map((o) => o.textContent?.trim())).toEqual(['Home', 'Work']);
      account.value = '4';
      account.dispatchEvent(new Event('change'));
      expect(lockRequest().body.widgets).toEqual([{ kind: 'traffic', spot: 'center', account: 4 }]);
      await stable();

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const from = root.querySelector('#lock-traffic-0-origin') as HTMLInputElement;
      from.value = 'Utr';
      from.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(400);
      expect(http.expectOne((r) => r.url === '/api/traffic/places').request.params.get('account')).toBe('4');
      vi.useRealTimers();
    });

    it('shows a device value, starting on a temperature, picked from capability signals', async () => {
      const root = await render([{ ...display('1', 'Hallway', ['k'], status({})), lockWidgets: [{ kind: 'clock', spot: 'bottom-right' }] }], [], '/displays/1/lock');
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

  it('opens the details page first, with a tab for each part of the setup', async () => {
    const root = await render([display('1', 'Hallway', ['k'], status({}))], [], '/displays/1');

    expect(root.querySelector('h1')?.textContent).toBe('Hallway');
    expect([...root.querySelectorAll('.tab')].map((t) => t.textContent?.trim())).toEqual(['Details', 'Dashboards', 'When idle', 'Lock screen']);
    expect(root.querySelector('.tab[aria-current="page"]')?.textContent).toBe('Details');
  });

  describe('details', () => {
    const tablet: ScreenDetails = {
      screenWidth: 1280,
      screenHeight: 800,
      viewportWidth: 1280,
      viewportHeight: 752,
      pixelRatio: 1.5,
      orientation: 'landscape-primary',
      userAgent: 'Mozilla/5.0 (Linux; Android 11; Lenovo TB; wv) AppleWebKit/537.36 Version/4.0 Chrome/119.0.0.0 Safari/537.36',
      language: 'nl-NL',
      timeZone: 'Europe/Amsterdam',
      touchPoints: 5,
      secureContext: false,
      connection: '4g',
      loadedAt: null,
      fully: { version: '1.57', api: ['turnScreenOff', 'turnScreenOn'] },
      light: { available: true, source: 'camera' },
      battery: { level: 0.8, charging: true },
    };
    const rows = (root: HTMLElement) => Object.fromEntries([...root.querySelectorAll('dt')].map((t) => [t.textContent, t.nextElementSibling?.textContent?.replace(/\s+/g, ' ').trim()]));

    it('shows the resolution, browser, Fully Kiosk support, light and battery', async () => {
      const root = await render([display('1', 'Hallway', ['k'], status({ connected: true, kiosk: true, lux: 1234, details: tablet }))], [], '/displays/1/details');
      const r = rows(root);

      expect(r['Resolution']).toBe('1280 × 800 (1920 × 1200 pixels)');
      expect(r['Browser']).toBe('Android WebView 119');
      expect(r['System']).toBe('Android 11');
      expect(r['JavaScript interface']).toBe('Supported');
      expect(r['Current']).toBe('1,234 lx');
      expect(r['Measured with']).toBe('Camera (an estimate)');
      expect(r['Battery']).toBe('80%, charging');
      expect(r['Secure context']).toContain('No');
    });

    it('says when it is not Fully Kiosk Browser', async () => {
      const root = await render([display('1', 'Hallway', ['k'], status({ connected: true, details: { ...tablet, fully: null } }))], [], '/displays/1/details');

      expect(root.textContent).toContain('Not supported here');
    });

    it('asks for a reload while the screen has not reported', async () => {
      const root = await render([display('1', 'Hallway', ['k'], status({}))], [], '/displays/1/details');

      expect(root.textContent).toContain('No details yet');
    });
  });

  describe('screenshot', () => {
    const button = (root: HTMLElement) => root.querySelector('hd-display-screenshot button') as HTMLButtonElement;

    it('asks the screen for a picture and shows it', async () => {
      URL.createObjectURL = () => 'blob:shot';
      const root = await render([display('1', 'Hallway', ['k'], status({ connected: true }))], [], '/displays/1/details');

      button(root).click();
      TestBed.inject(HttpTestingController).expectOne('/api/displays/1/screenshot').flush(new Blob(['jpeg'], { type: 'image/jpeg' }));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(root.querySelector('hd-display-screenshot img')?.getAttribute('src')).toBe('blob:shot');
      expect(button(root).textContent?.trim()).toBe('Take another');
    });

    it('cannot be taken while the display is not connected', async () => {
      const root = await render([display('1', 'Hallway', ['k'], status({}))], [], '/displays/1/details');

      expect(button(root).disabled).toBe(true);
    });

    it('says when the screen does not answer', async () => {
      const root = await render([display('1', 'Hallway', ['k'], status({ connected: true }))], [], '/displays/1/details');

      button(root).click();
      TestBed.inject(HttpTestingController).expectOne('/api/displays/1/screenshot').flush(new Blob([]), { status: 504, statusText: 'Gateway Timeout' });
      await TestBed.inject(ApplicationRef).whenStable();

      expect(root.querySelector('hd-display-screenshot [role="alert"]')?.textContent).toContain('did not answer');
    });
  });

  describe('name', () => {
    it('renames the display', async () => {
      const root = await render([display('1', 'Hallway', ['k'], status({}))], [], '/displays/1/details');
      const name = root.querySelector('#display-name') as HTMLInputElement;

      name.value = 'Entrance';
      name.dispatchEvent(new Event('change'));

      expect(TestBed.inject(HttpTestingController).expectOne('/api/displays/1').request.body).toEqual({ name: 'Entrance' });
    });
  });

  it('follows status pushed over the realtime connection', async () => {
    const root = await render([display('1', 'Hallway', [], status({}))], [], '/displays');

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
