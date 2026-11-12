import { computed, inject, Injectable, signal } from '@angular/core';
import { capabilitySignal, NEWS_SOURCES, DashboardVersion, TrafficRoute, DisplayInfo, DisplaysApi, IdleRule, LockSpot, LockWidget, Realtime, Rule, SignalInfo, stopOnDestroy } from '@homey-dash/api-client';
import { alwaysRule, TileData } from '@homey-dash/tiles/data';
import { DashboardsStore } from '../dashboards-store';
import { SignalCatalogue } from '../editor/signal-catalogue';
import { changedAt, clock, moved, removedAt, timeAgo } from '@homey-dash/design-system';
import { t } from '@homey-dash/i18n';

/** How many widgets a lock screen shows at most. */
export const MAX_LOCK_WIDGETS = 8;

/** Whether a signal is a capability of a device in Homey, which a lock screen value shows. */
export function isLuminanceSignal(signal: SignalInfo) {
  return capabilitySignal(signal.id)?.capability === 'measure_luminance';
}

export function isCapabilitySignal(signal: SignalInfo) {
  return capabilitySignal(signal.id) !== null;
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
  private readonly now = clock(30_000);

  constructor() {
    stopOnDestroy(
      this.realtime.on('Displays', (list) => this.list.set(list)),
      this.realtime.whenConnected(() => this.join()),
    );
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
    this.assign(display, moved(display.dashboardIds, index, by));
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
    const text = version.shownVersion ? t('Shows version {shown} of {latest}', { shown: version.shownVersion, latest: version.latestVersion }) : t('Not showing it yet');
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
    this.saveIdle(display, changedAt(display.idleRules, index, (r) => ({ ...r, ...change })));
  }

  setIdleColor(display: DisplayInfo, index: number, color: string) {
    this.saveIdle(display, changedAt(display.idleRules, index, (r) => ({ ...r, color })));
  }

  setIdleReturn(display: DisplayInfo, index: number, dashboardId: string) {
    this.saveIdle(display, changedAt(display.idleRules, index, (r) => ({ ...r, returnDashboardId: dashboardId || null })));
  }

  setIdleRule(display: DisplayInfo, index: number, rule: Rule) {
    this.saveIdle(display, changedAt(display.idleRules, index, (r) => ({ ...r, rule })));
  }

  moveIdle(display: DisplayInfo, index: number, by: -1 | 1) {
    this.saveIdle(display, moved(display.idleRules, index, by));
  }

  removeIdle(display: DisplayInfo, index: number) {
    this.saveIdle(display, removedAt(display.idleRules, index));
  }

  // Shown at once, so the rule editor keeps up with every change, and put right by what HomeyDash answers.
  private saveIdle(display: DisplayInfo, idleRules: IdleRule[]) {
    this.replace({ ...display, idleRules });
    this.api.setIdleRules(display.id, idleRules).subscribe({ next: (d) => this.replace(d), error: () => this.fail('save the idle rules of') });
  }

  // Lock screen

  // A new widget is a clock in the middle while there is none yet, else the weather at the top right.
  addLock(display: DisplayInfo, spot?: LockSpot) {
    const widget: LockWidget = display.lockWidgets.some((w) => w.kind === 'clock')
      ? { kind: 'weather', spot: spot ?? 'top-right' }
      : { kind: 'clock', spot: spot ?? 'center' };
    this.saveLock(display, [...display.lockWidgets, widget]);
  }

  // A value starts on a temperature, the reading a lock screen shows most, or else on the first capability there is.
  setLockKind(display: DisplayInfo, index: number, kind: LockWidget['kind']) {
    const { spot, hidden, rule } = display.lockWidgets[index];
    let widget: LockWidget = { kind: 'clock', spot };
    if (kind === 'weather' || kind === 'traffic' || kind === 'news') widget = { kind, spot };
    if (kind === 'value') {
      const signals = (this.catalogue.signals() ?? []).filter(isCapabilitySignal);
      const signal = signals.find((s) => s.id.endsWith(':measure_temperature')) ?? signals[0];
      if (!signal) {
        this.error.set(t('There is no device value to show yet. Set up a Homey account first.'));
        return;
      }
      widget = { kind, spot, signal: signal.id };
    }
    // Whether and when it shows belongs to the place in the list, not to what it shows.
    this.saveLock(display, changedAt(display.lockWidgets, index, () => ({ ...widget, ...(hidden ? { hidden } : {}), ...(rule ? { rule } : {}) })));
  }

  // Always shows it, never (kept, but left out) or only while a rule holds; a rule starts as one that always holds.
  setLockVisibility(display: DisplayInfo, index: number, choice: 'always' | 'never' | 'rule') {
    const rule = display.lockWidgets[index].rule ?? alwaysRule();
    this.saveLock(
      display,
      changedAt(display.lockWidgets, index, (w) => ({ ...w, hidden: choice === 'never' || undefined, rule: choice === 'rule' ? rule : undefined })),
    );
  }

  setLockRule(display: DisplayInfo, index: number, rule: Rule) {
    this.saveLock(display, changedAt(display.lockWidgets, index, (w) => ({ ...w, rule })));
  }

  setLockSpot(display: DisplayInfo, index: number, spot: LockSpot) {
    this.saveLock(display, changedAt(display.lockWidgets, index, (w) => ({ ...w, spot })));
  }

  // The oldest account of its kind is the one a widget without an account uses: a weather's Homey, or traffic's TomTom
  // account, which the caller knows.
  setLockAccount(display: DisplayInfo, index: number, account: string, oldest = this.homeys()[0]?.accountId) {
    const id = Number(account);
    const chosen = id === oldest ? null : id;
    this.saveLock(
      display,
      display.lockWidgets.map((w, i) => (i === index && (w.kind === 'weather' || w.kind === 'traffic') ? { ...w, account: chosen } : w)),
    );
  }

  // Traffic shows nothing until its route is chosen.
  setLockRoute(display: DisplayInfo, index: number, route: TrafficRoute) {
    this.saveLock(display, display.lockWidgets.map((w, i) => (i === index && w.kind === 'traffic' ? { ...w, route } : w)));
  }

  // The first source is the one a widget without a source shows.
  setLockSource(display: DisplayInfo, index: number, source: string) {
    const chosen = source === NEWS_SOURCES[0].id ? null : source;
    this.saveLock(display, display.lockWidgets.map((w, i) => (i === index && w.kind === 'news' ? { ...w, source: chosen } : w)));
  }

  // A device in Homey that measures the light for the display, or null to have the screen measure it.
  setLightSource(display: DisplayInfo, signal: string | null) {
    this.api.setLightSource(display.id, signal).subscribe({ next: (d) => this.replace(d), error: () => this.fail('set the light source of') });
  }

  // The language the display's screen speaks, or null for its browser's.
  setLanguage(display: DisplayInfo, language: string | null) {
    this.api.setLanguage(display.id, language).subscribe({ next: (d) => this.replace(d), error: () => this.fail('set the language of') });
  }

  // What timers started by voice on the display ring with, or null for a beep.
  setTimerSound(display: DisplayInfo, sound: string | null) {
    this.api.setTimerSound(display.id, sound).subscribe({ next: (d) => this.replace(d), error: () => this.fail('set the timer sound of') });
  }

  // The zone in Homey the display's screen is in, or null for none.
  setZone(display: DisplayInfo, zone: { accountId: number; zoneId: string } | null) {
    this.api.setZone(display.id, zone).subscribe({ next: (d) => this.replace(d), error: () => this.fail('set the zone of') });
  }

  setLockSignal(display: DisplayInfo, index: number, signal: string) {
    this.saveLock(display, display.lockWidgets.map((w, i) => (i === index && w.kind === 'value' ? { ...w, signal } : w)));
  }

  // Swaps two widgets; the lock tab swaps neighbours within one place, which may not be neighbours in the list.
  swapLock(display: DisplayInfo, a: number, b: number) {
    const list = [...display.lockWidgets];
    [list[a], list[b]] = [list[b], list[a]];
    this.saveLock(display, list);
  }

  removeLock(display: DisplayInfo, index: number) {
    this.saveLock(display, removedAt(display.lockWidgets, index));
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
