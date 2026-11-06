import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  DashboardVersion,
  DisplayInfo,
  DisplaysApi,
  IdleRule,
  LockSpot,
  LockWidget,
  Realtime,
  Rule,
  SignalInfo,
} from '@homey-dash/api-client';
import { alwaysRule, TileData } from '@homey-dash/tiles';
import { DashboardsStore } from '../dashboards-store';
import { SignalCatalogue } from '../editor/signal-catalogue';

/** How many widgets a lock screen shows at most. */
export const MAX_LOCK_WIDGETS = 8;

/** Whether a signal is a capability of a device in Homey, which a lock screen value shows. */
export function isCapabilitySignal(signal: SignalInfo) {
  return /^homey:\d+:capability:/.test(signal.id);
}

/** How long ago an ISO time was, roughly, as of `now` (ms). */
export function timeAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Every display, kept current over the realtime connection, and the changes Management makes to them. Shared by the
 * sidebar, the overview and the pages of one display. Displays are added by running setup on a screen.
 */
@Injectable({ providedIn: 'root' })
export class DisplaysStore {
  private readonly api = inject(DisplaysApi);
  private readonly realtime = inject(Realtime);
  private readonly dashboardStore = inject(DashboardsStore);
  private readonly catalogue = inject(SignalCatalogue);
  private readonly data = inject(TileData);

  readonly list = signal<DisplayInfo[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly homeys = computed(() => this.data.homeys() ?? []);
  readonly photoSets = computed(() => [...this.data.photoSets().values()].sort((a, b) => a.name.localeCompare(b.name)));
  readonly dashboards = computed(() =>
    this.dashboardStore.list().map((d) => ({ id: d.id, name: d.name, published: d.publishedVersion > 0 })),
  );

  // Ticks so "last seen" stays true while Management is open.
  private readonly now = signal(Date.now());

  constructor() {
    const ticker = setInterval(() => this.now.set(Date.now()), 30_000);
    const stops = [
      this.realtime.on('Displays', (list) => this.list.set(list)),
      this.realtime.whenConnected(() => this.join()),
    ];
    inject(DestroyRef).onDestroy(() => {
      clearInterval(ticker);
      stops.forEach((stop) => stop());
    });
  }

  get(id: string) {
    return this.list().find((d) => d.id === id);
  }

  ago(iso: string) {
    return timeAgo(iso, this.now());
  }

  private async join() {
    try {
      this.list.set(await this.realtime.joinManagement());
      this.loaded.set(true);
    } catch {
      // The connection dropped again; joining happens again on reconnect.
    }
  }

  rename(display: DisplayInfo, name: string) {
    if (!name.trim() || name.trim() === display.name) return;
    this.api.rename(display.id, name).subscribe({ next: (d) => this.replace(d), error: () => this.fail('rename') });
  }

  remove(display: DisplayInfo, done: () => void) {
    this.api.delete(display.id).subscribe({
      next: () => {
        this.list.update((list) => list.filter((d) => d.id !== display.id));
        done();
      },
      error: () => this.fail('remove'),
    });
  }

  // Dashboards

  // A dashboard it starts offering goes last on its tape.
  offer(display: DisplayInfo, dashboardId: string, offered: boolean) {
    const ids = display.dashboardIds.filter((id) => id !== dashboardId);
    this.assign(display, offered ? [...ids, dashboardId] : ids);
  }

  moveDashboard(display: DisplayInfo, index: number, by: -1 | 1) {
    const ids = [...display.dashboardIds];
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    this.assign(display, ids);
  }

  // The published dashboards it doesn't offer yet.
  offerable(display: DisplayInfo) {
    return this.dashboards().filter((d) => d.published && !display.dashboardIds.includes(d.id));
  }

  dashboardName(dashboardId: string | null) {
    return this.dashboards().find((d) => d.id === dashboardId)?.name ?? 'Dashboard';
  }

  private assign(display: DisplayInfo, dashboardIds: string[]) {
    this.api.assign(display.id, dashboardIds).subscribe({ next: (d) => this.replace(d), error: () => this.fail('assign') });
  }

  // Named after its dashboard when the display offers more than one.
  behind(version: DashboardVersion, named: boolean) {
    const text = version.shownVersion ? `Shows version ${version.shownVersion} of ${version.latestVersion}` : 'Not showing it yet';
    if (!named) return text;
    return `${this.dashboardName(version.dashboardId)}: ${text[0].toLowerCase()}${text.slice(1)}`;
  }

  // Idle rules

  photoSetName(photoSetId: string) {
    return this.data.photoSets().get(`photo-set:${photoSetId}`)?.name;
  }

  // A new rule starts as one that always holds, on its first dashboard.
  addIdle(display: DisplayInfo) {
    this.saveIdle(display, [...display.idleRules, { dashboardId: display.dashboardIds[0], rule: alwaysRule() }]);
  }

  // `dashboard:<id>` shows that dashboard; `photos:<id>` plays that photo set and `color` fills with black until
  // another colour is picked, all going back to the last used. `screen-off` turns the screen off (Fully Kiosk Browser; black elsewhere).
  setIdleAction(display: DisplayInfo, index: number, action: string) {
    const [kind, id] = action.split(':');
    const none = { dashboardId: null, photoSetId: null, color: null, screenOff: false, returnDashboardId: null };
    const change =
      kind === 'photos' ? { ...none, photoSetId: id } : kind === 'color' ? { ...none, color: '#000000' } : kind === 'screen-off' ? { ...none, screenOff: true } : { ...none, dashboardId: id };
    this.saveIdle(display, display.idleRules.map((r, i) => (i === index ? { ...r, ...change } : r)));
  }

  setIdleColor(display: DisplayInfo, index: number, color: string) {
    this.saveIdle(display, display.idleRules.map((r, i) => (i === index ? { ...r, color } : r)));
  }

  setIdleReturn(display: DisplayInfo, index: number, dashboardId: string) {
    this.saveIdle(display, display.idleRules.map((r, i) => (i === index ? { ...r, returnDashboardId: dashboardId || null } : r)));
  }

  setIdleRule(display: DisplayInfo, index: number, rule: Rule) {
    this.saveIdle(display, display.idleRules.map((r, i) => (i === index ? { ...r, rule } : r)));
  }

  moveIdle(display: DisplayInfo, index: number, by: -1 | 1) {
    const rules = [...display.idleRules];
    [rules[index], rules[index + by]] = [rules[index + by], rules[index]];
    this.saveIdle(display, rules);
  }

  removeIdle(display: DisplayInfo, index: number) {
    this.saveIdle(display, display.idleRules.filter((_, i) => i !== index));
  }

  // Shown at once, so the rule editor keeps up with every change, and put right by what HomeyDash answers.
  private saveIdle(display: DisplayInfo, idleRules: IdleRule[]) {
    this.replace({ ...display, idleRules });
    this.api.setIdleRules(display.id, idleRules).subscribe({ next: (d) => this.replace(d), error: () => this.fail('save the idle rules of') });
  }

  // Lock screen

  // A new widget is a clock in the middle while there is none yet, else the weather at the top right.
  addLock(display: DisplayInfo) {
    const widget: LockWidget = display.lockWidgets.some((w) => w.kind === 'clock')
      ? { kind: 'weather', spot: 'top-right' }
      : { kind: 'clock', spot: 'center' };
    this.saveLock(display, [...display.lockWidgets, widget]);
  }

  // A value starts on a temperature, the reading a lock screen shows most, or else on the first capability there is.
  setLockKind(display: DisplayInfo, index: number, kind: LockWidget['kind']) {
    const spot = display.lockWidgets[index].spot;
    let widget: LockWidget = { kind: 'clock', spot };
    if (kind === 'weather') widget = { kind, spot };
    if (kind === 'value') {
      const signals = (this.catalogue.signals() ?? []).filter(isCapabilitySignal);
      const signal = signals.find((s) => s.id.endsWith(':measure_temperature')) ?? signals[0];
      if (!signal) {
        this.error.set('There is no device value to show yet. Set up a Homey account first.');
        return;
      }
      widget = { kind, spot, signal: signal.id };
    }
    this.saveLock(display, display.lockWidgets.map((w, i) => (i === index ? widget : w)));
  }

  setLockSpot(display: DisplayInfo, index: number, spot: LockSpot) {
    this.saveLock(display, display.lockWidgets.map((w, i) => (i === index ? { ...w, spot } : w)));
  }

  // The oldest Homey is the one a weather without an account shows.
  setLockAccount(display: DisplayInfo, index: number, account: string) {
    const id = Number(account);
    const chosen = id === this.homeys()[0]?.accountId ? null : id;
    this.saveLock(display, display.lockWidgets.map((w, i) => (i === index && w.kind === 'weather' ? { ...w, account: chosen } : w)));
  }

  setLockSignal(display: DisplayInfo, index: number, signal: string) {
    this.saveLock(display, display.lockWidgets.map((w, i) => (i === index && w.kind === 'value' ? { ...w, signal } : w)));
  }

  moveLock(display: DisplayInfo, index: number, by: -1 | 1) {
    const widgets = [...display.lockWidgets];
    [widgets[index], widgets[index + by]] = [widgets[index + by], widgets[index]];
    this.saveLock(display, widgets);
  }

  removeLock(display: DisplayInfo, index: number) {
    this.saveLock(display, display.lockWidgets.filter((_, i) => i !== index));
  }

  private saveLock(display: DisplayInfo, lockWidgets: LockWidget[]) {
    this.replace({ ...display, lockWidgets });
    this.api.setLockScreen(display.id, lockWidgets).subscribe({ next: (d) => this.replace(d), error: () => this.fail('save the lock screen of') });
  }

  private replace(display: DisplayInfo) {
    this.error.set(null);
    this.list.update((list) => list.map((d) => (d.id === display.id ? display : d)));
  }

  private fail(what: string) {
    this.error.set(`Could not ${what} the display. Try again.`);
  }
}
