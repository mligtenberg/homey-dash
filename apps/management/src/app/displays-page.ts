import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import {
  DashboardVersion,
  DisplayInfo,
  DisplaysApi,
  IdleRule,
  LOCK_SPOTS,
  LockSpot,
  LockWidget,
  Realtime,
  Rule,
  SignalInfo,
} from '@homey-dash/api-client';
import { alwaysRule, TileData } from '@homey-dash/tiles';
import { DashboardsStore } from './dashboards-store';
import { RuleEditor } from './editor/rule-editor';
import { describeRule } from './editor/rule-text';
import { SignalCatalogue } from './editor/signal-catalogue';
import { SignalPicker } from './editor/signal-picker';

/** How many widgets a lock screen shows at most. */
export const MAX_LOCK_WIDGETS = 8;

const SPOT_NAMES: Record<LockSpot, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  center: 'Middle',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

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
 * Every display, with the dashboards it offers on its tape in order, the idle rules that choose which of them it shows,
 * or which photo set it plays, when left alone, and its display status, kept current over the realtime connection. Displays are added by running
 * setup on a screen.
 */
@Component({
  selector: 'hd-displays-page',
  imports: [DecimalPipe, RuleEditor, SignalPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header">
      <h1>Displays</h1>
    </header>
    <div class="body">
      @if (loaded() && displays().length === 0) {
        <div class="empty hd-panel">
          <h2>No displays yet</h2>
          <p>Open HomeyDash's display address on a screen in the home. It asks for a name and then shows up here.</p>
        </div>
      }
      @for (display of displays(); track display.id) {
        <div class="display hd-panel">
          <div class="hd-field">
            <label class="hd-field__label" [for]="'name-' + display.id">Name</label>
            <input
              class="hd-input"
              [id]="'name-' + display.id"
              [value]="display.name"
              (change)="rename(display, name.value)"
              (keydown.enter)="name.blur()"
              #name
            />
          </div>
          <div class="status">
            @let status = display.status;
            @if (!status.held) {
              <span class="hd-pill hd-pill--warn" title="Its screen became another display. Take it over from setup on a screen.">No screen</span>
            } @else if (status.connected) {
              <span class="hd-pill hd-pill--ok hd-pill--dot">Connected</span>
            } @else {
              <span class="hd-pill hd-pill--dot">{{ status.lastSeenAt ? 'Last seen ' + ago(status.lastSeenAt) : 'Never connected' }}</span>
            }
            @if (status.connected) {
              @if (status.kiosk) {
                <span class="hd-pill hd-pill--ok" title="This screen runs in Fully Kiosk Browser, so idle rules can turn it off.">Fully Kiosk</span>
              }
              @if (status.lux !== null) {
                <span class="hd-pill" title="Light falling on the screen">{{ status.lux | number: '1.0-0' }} lx</span>
              }
            }
            @if (!display.dashboardIds.length) {
              <span class="hd-pill hd-pill--dot">Waiting for a dashboard</span>
            } @else if (status.held) {
              @for (version of status.versions; track version.dashboardId) {
                @if (version.shownVersion !== version.latestVersion) {
                  <span class="hd-pill hd-pill--warn">{{ behind(version, status.versions.length > 1) }}</span>
                }
              }
            }
          </div>
          @if (removing() === display.id) {
            <div class="confirm">
              <span>Its screen goes back to setup.</span>
              <button class="hd-btn hd-btn--primary" type="button" (click)="remove(display)">Remove</button>
              <button class="hd-btn" type="button" (click)="removing.set(null)">Cancel</button>
            </div>
          } @else {
            <button class="hd-btn hd-btn--danger remove" type="button" (click)="removing.set(display.id)">Remove display</button>
          }
          <fieldset class="dashboards">
            <legend class="hd-field__label">Dashboards</legend>
            <p class="hint">On its tape in this order. It starts on the first.</p>
            @for (id of display.dashboardIds; track id; let i = $index, first = $first, last = $last) {
              <div class="dashboards__entry">
                <label class="hd-check">
                  <input type="checkbox" checked (change)="offer(display, id, false)" />
                  {{ dashboardName(id) }}
                </label>
                <button type="button" class="hd-btn" [attr.aria-label]="'Move ' + dashboardName(id) + ' up'" [disabled]="first" (click)="moveDashboard(display, i, -1)">↑</button>
                <button type="button" class="hd-btn" [attr.aria-label]="'Move ' + dashboardName(id) + ' down'" [disabled]="last" (click)="moveDashboard(display, i, 1)">↓</button>
              </div>
            }
            @for (option of offerable(display); track option.id) {
              <label class="hd-check">
                <input type="checkbox" (change)="offer(display, option.id, true)" />
                {{ option.name }}
              </label>
            } @empty {
              @if (!display.dashboardIds.length) {
                <span class="hint">Publish a dashboard to offer it here.</span>
              }
            }
          </fieldset>
          @if (display.dashboardIds.length) {
            <div class="idle">
              <span class="hd-field__label">When left alone</span>
              <p class="hint">
                A minute after the last touch, and for as long as no one touches it, it does the first of these whose rule
                holds. While none holds, it stays on what it shows. A photo set or colour fills the screen until someone touches it.
              </p>
              @for (idle of display.idleRules; track $index; let i = $index, last = $last) {
                <div class="idle__entry">
                  <select
                    class="hd-select"
                    [attr.aria-label]="'What rule ' + (i + 1) + ' does'"
                    (change)="setIdleAction(display, i, $any($event.target).value)"
                  >
                    <optgroup label="Show dashboard">
                      @for (id of display.dashboardIds; track id) {
                        <option [value]="'dashboard:' + id" [selected]="id === idle.dashboardId">{{ dashboardName(id) }}</option>
                      }
                    </optgroup>
                    @if (idle.photoSetId || photoSets().length) {
                      <optgroup label="Play photo set">
                        @if (idle.photoSetId && !photoSetName(idle.photoSetId)) {
                          <option selected disabled>Photo set not found</option>
                        }
                        @for (set of photoSets(); track set.id) {
                          <option [value]="'photos:' + set.id" [selected]="set.id === idle.photoSetId">{{ set.name }}</option>
                        }
                      </optgroup>
                    }
                    <optgroup label="Fill with colour">
                      <option value="color" [selected]="!!idle.color">Colour</option>
                    </optgroup>
                    <optgroup label="Screen">
                      <option value="screen-off" [selected]="!!idle.screenOff">Turn screen off</option>
                    </optgroup>
                  </select>
                  @if (idle.color) {
                    <input
                      type="color"
                      class="idle__color"
                      [attr.aria-label]="'Colour of rule ' + (i + 1)"
                      [value]="idle.color"
                      (change)="setIdleColor(display, i, $any($event.target).value)"
                    />
                  }
                  @if (idle.photoSetId || idle.color || idle.screenOff) {
                    <select
                      class="hd-select"
                      [attr.aria-label]="'Where a touch goes back to for rule ' + (i + 1)"
                      (change)="setIdleReturn(display, i, $any($event.target).value)"
                    >
                      <option value="" [selected]="!idle.returnDashboardId">Back to the last used</option>
                      @for (id of display.dashboardIds; track id) {
                        <option [value]="id" [selected]="id === idle.returnDashboardId">Back to {{ dashboardName(id) }}</option>
                      }
                    </select>
                  }
                  <button
                    type="button"
                    class="idle__rule"
                    [attr.aria-expanded]="isOpen(display, i)"
                    (click)="toggleRule(display, i)"
                  >
                    {{ describe(idle.rule) }}
                  </button>
                  <button type="button" class="hd-btn" [attr.aria-label]="'Move rule ' + (i + 1) + ' up'" [disabled]="i === 0" (click)="moveIdle(display, i, -1)">↑</button>
                  <button type="button" class="hd-btn" [attr.aria-label]="'Move rule ' + (i + 1) + ' down'" [disabled]="last" (click)="moveIdle(display, i, 1)">↓</button>
                  <button type="button" class="hd-btn" [attr.aria-label]="'Remove rule ' + (i + 1)" (click)="removeIdle(display, i)">✕</button>
                </div>
                @if (isOpen(display, i)) {
                  <hd-rule-editor class="idle__editor" [rule]="idle.rule" (changed)="setIdleRule(display, i, $event)" />
                }
              }
              <button type="button" class="hd-btn idle__add" (click)="addIdle(display)">Add a rule</button>
            </div>
            <div class="lock">
              <span class="hd-field__label">Lock screen</span>
              <p class="hint">Shown over a photo set or colour while an idle rule plays it. Widgets in the same place stack in this order.</p>
              @for (widget of display.lockWidgets; track $index; let i = $index, last = $last) {
                <div class="lock__entry">
                  <select class="hd-select" [attr.aria-label]="'What widget ' + (i + 1) + ' shows'" (change)="setLockKind(display, i, $any($event.target).value)">
                    <option value="clock" [selected]="widget.kind === 'clock'">Time and date</option>
                    <option value="weather" [selected]="widget.kind === 'weather'">Weather</option>
                    <option value="value" [selected]="widget.kind === 'value'">Device value</option>
                  </select>
                  <select class="hd-select" [attr.aria-label]="'Where widget ' + (i + 1) + ' sits'" (change)="setLockSpot(display, i, $any($event.target).value)">
                    @for (spot of spots; track spot) {
                      <option [value]="spot" [selected]="spot === widget.spot">{{ spotName(spot) }}</option>
                    }
                  </select>
                  @if (widget.kind === 'weather' && homeys().length > 1) {
                    <select class="hd-select" [attr.aria-label]="'Whose weather widget ' + (i + 1) + ' shows'" (change)="setLockAccount(display, i, $any($event.target).value)">
                      @for (homey of homeys(); track homey.accountId) {
                        <option [value]="homey.accountId" [selected]="(widget.account ?? homeys()[0].accountId) === homey.accountId">{{ homey.accountName }}</option>
                      }
                    </select>
                  } @else if (widget.kind === 'value') {
                    <hd-signal-picker class="lock__signal" [value]="widget.signal" [only]="isCapability" (picked)="setLockSignal(display, i, $event)" />
                  } @else {
                    <span class="lock__spacer"></span>
                  }
                  <button type="button" class="hd-btn" [attr.aria-label]="'Move widget ' + (i + 1) + ' up'" [disabled]="i === 0" (click)="moveLock(display, i, -1)">↑</button>
                  <button type="button" class="hd-btn" [attr.aria-label]="'Move widget ' + (i + 1) + ' down'" [disabled]="last" (click)="moveLock(display, i, 1)">↓</button>
                  <button type="button" class="hd-btn" [attr.aria-label]="'Remove widget ' + (i + 1)" (click)="removeLock(display, i)">✕</button>
                </div>
              }
              <button type="button" class="hd-btn lock__add" [disabled]="display.lockWidgets.length >= maxLock" (click)="addLock(display)">Add a widget</button>
            </div>
          }
        </div>
      }
      @if (error(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styles: `
    .header { display: flex; align-items: center; padding: var(--space-4) var(--space-6); border-bottom: 1px solid var(--line); }
    h1 { font-size: 22px; font-weight: 800; margin: 0; }
    h2 { font-size: 18px; font-weight: 800; margin: 0 0 var(--space-2); }
    .body { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); max-width: 900px; }
    .empty { padding: var(--space-6); }
    .empty p { margin: 0; color: var(--ink-muted); }
    .display { display: grid; grid-template-columns: 1fr auto auto; align-items: end; gap: var(--space-4); padding: var(--space-4); }
    .status { display: flex; flex-wrap: wrap; gap: var(--space-2); padding-bottom: 6px; white-space: nowrap; }
    .remove { padding-bottom: 10px; }
    .dashboards { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); margin: 0; padding: 0; border: 0; }
    .dashboards legend { padding: 0; margin-bottom: var(--space-2); }
    .dashboards .hint { margin: 0; font-size: 13px; }
    .dashboards__entry { display: flex; align-items: center; gap: var(--space-1); }
    .dashboards__entry .hd-check { min-width: 180px; }
    .dashboards__entry .hd-btn { padding-inline: 10px; }
    .hint { color: var(--ink-muted); }
    .idle { grid-column: 1 / -1; display: flex; flex-direction: column; gap: var(--space-2); }
    .idle .hint { margin: 0; font-size: 13px; }
    .idle__entry { display: flex; align-items: center; gap: var(--space-1); }
    .idle__entry .hd-select { flex: 0 1 200px; min-width: 0; }
    .idle__entry .hd-btn { padding-inline: 10px; }
    .idle__color { flex: none; width: 40px; height: 36px; padding: 2px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--chrome); cursor: pointer; }
    .idle__rule {
      flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel);
      color: var(--ink-muted); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .idle__rule:hover, .idle__rule[aria-expanded='true'] { border-color: var(--brand); }
    .idle__editor { padding: var(--space-3); border: 1px solid var(--line); border-radius: 10px; }
    .idle__add { align-self: flex-start; }
    .lock { grid-column: 1 / -1; display: flex; flex-direction: column; gap: var(--space-2); }
    .lock .hint { margin: 0; font-size: 13px; }
    .lock__entry { display: flex; align-items: center; gap: var(--space-1); }
    .lock__entry .hd-select { flex: 0 1 170px; min-width: 0; }
    .lock__entry .hd-btn { padding-inline: 10px; }
    .lock__signal, .lock__spacer { flex: 1 1 0; min-width: 0; display: block; }
    .lock__add { align-self: flex-start; }
    .confirm { display: flex; align-items: center; gap: var(--space-2); color: var(--ink-muted); }
    .error { margin: 0; color: var(--danger); font-weight: 700; }
    @media (max-width: 860px) {
      .display { grid-template-columns: 1fr; align-items: stretch; }
    }
  `,
})
export class DisplaysPage {
  private readonly api = inject(DisplaysApi);
  private readonly realtime = inject(Realtime);
  private readonly store = inject(DashboardsStore);
  private readonly catalogue = inject(SignalCatalogue);
  private readonly data = inject(TileData);

  protected readonly displays = signal<DisplayInfo[]>([]);
  protected readonly loaded = signal(false);
  protected readonly removing = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  // The idle rule whose editor is open.
  protected readonly openRule = signal<{ display: string; index: number } | null>(null);
  protected readonly homeys = computed(() => this.data.homeys() ?? []);
  protected readonly spots = LOCK_SPOTS;
  protected readonly maxLock = MAX_LOCK_WIDGETS;
  protected readonly isCapability = isCapabilitySignal;
  protected readonly photoSets = computed(() => [...this.data.photoSets().values()].sort((a, b) => a.name.localeCompare(b.name)));
  protected readonly dashboards = computed(() =>
    this.store.list().map((d) => ({ id: d.id, name: d.name, published: d.publishedVersion > 0 })),
  );

  // Ticks so "last seen" stays true while the page is open.
  private readonly now = signal(Date.now());

  constructor() {
    const ticker = setInterval(() => this.now.set(Date.now()), 30_000);
    const stops = [
      this.realtime.on('Displays', (list) => this.displays.set(list)),
      this.realtime.whenConnected(() => this.join()),
    ];
    inject(DestroyRef).onDestroy(() => {
      clearInterval(ticker);
      stops.forEach((stop) => stop());
    });
  }

  protected ago(iso: string) {
    return timeAgo(iso, this.now());
  }

  private async join() {
    try {
      this.displays.set(await this.realtime.joinManagement());
      this.loaded.set(true);
    } catch {
      // The connection dropped again; joining happens again on reconnect.
    }
  }

  protected rename(display: DisplayInfo, name: string) {
    if (!name.trim() || name.trim() === display.name) return;
    this.api.rename(display.id, name).subscribe({ next: (d) => this.replace(d), error: () => this.fail('rename') });
  }

  // A dashboard it starts offering goes last on its tape.
  protected offer(display: DisplayInfo, dashboardId: string, offered: boolean) {
    const ids = display.dashboardIds.filter((id) => id !== dashboardId);
    this.save(display, offered ? [...ids, dashboardId] : ids);
  }

  protected moveDashboard(display: DisplayInfo, index: number, by: -1 | 1) {
    const ids = [...display.dashboardIds];
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    this.save(display, ids);
  }

  // The published dashboards it doesn't offer yet.
  protected offerable(display: DisplayInfo) {
    return this.dashboards().filter((d) => d.published && !display.dashboardIds.includes(d.id));
  }

  protected dashboardName(dashboardId: string | null) {
    return this.dashboards().find((d) => d.id === dashboardId)?.name ?? 'Dashboard';
  }

  protected photoSetName(photoSetId: string) {
    return this.data.photoSets().get(`photo-set:${photoSetId}`)?.name;
  }

  protected describe(rule: Rule) {
    return describeRule(rule, this.catalogue.byId());
  }

  protected isOpen(display: DisplayInfo, index: number) {
    const open = this.openRule();
    return open?.display === display.id && open.index === index;
  }

  protected toggleRule(display: DisplayInfo, index: number) {
    this.openRule.set(this.isOpen(display, index) ? null : { display: display.id, index });
  }

  // A new rule starts as one that always holds, on its first dashboard, and opens to be set up.
  protected addIdle(display: DisplayInfo) {
    const dashboardId = display.dashboardIds[0];
    this.saveIdle(display, [...display.idleRules, { dashboardId, rule: alwaysRule() }]);
    this.openRule.set({ display: display.id, index: display.idleRules.length });
  }

  // `dashboard:<id>` shows that dashboard; `photos:<id>` plays that photo set and `color` fills with black until
  // another colour is picked, all going back to the last used. `screen-off` turns the screen off (Fully Kiosk Browser; black elsewhere).
  protected setIdleAction(display: DisplayInfo, index: number, action: string) {
    const [kind, id] = action.split(':');
    const none = { dashboardId: null, photoSetId: null, color: null, screenOff: false, returnDashboardId: null };
    const change =
      kind === 'photos' ? { ...none, photoSetId: id } : kind === 'color' ? { ...none, color: '#000000' } : kind === 'screen-off' ? { ...none, screenOff: true } : { ...none, dashboardId: id };
    this.saveIdle(display, display.idleRules.map((r, i) => (i === index ? { ...r, ...change } : r)));
  }

  protected setIdleColor(display: DisplayInfo, index: number, color: string) {
    this.saveIdle(display, display.idleRules.map((r, i) => (i === index ? { ...r, color } : r)));
  }

  protected setIdleReturn(display: DisplayInfo, index: number, dashboardId: string) {
    this.saveIdle(display, display.idleRules.map((r, i) => (i === index ? { ...r, returnDashboardId: dashboardId || null } : r)));
  }

  protected setIdleRule(display: DisplayInfo, index: number, rule: Rule) {
    this.saveIdle(display, display.idleRules.map((r, i) => (i === index ? { ...r, rule } : r)));
  }

  protected moveIdle(display: DisplayInfo, index: number, by: -1 | 1) {
    const rules = [...display.idleRules];
    [rules[index], rules[index + by]] = [rules[index + by], rules[index]];
    if (this.isOpen(display, index)) this.openRule.set({ display: display.id, index: index + by });
    else if (this.isOpen(display, index + by)) this.openRule.set({ display: display.id, index });
    this.saveIdle(display, rules);
  }

  protected removeIdle(display: DisplayInfo, index: number) {
    if (this.isOpen(display, index)) this.openRule.set(null);
    this.saveIdle(display, display.idleRules.filter((_, i) => i !== index));
  }

  // Shown at once, so the rule editor keeps up with every change, and put right by what HomeyDash answers.
  private saveIdle(display: DisplayInfo, idleRules: IdleRule[]) {
    this.replace({ ...display, idleRules });
    this.api.setIdleRules(display.id, idleRules).subscribe({ next: (d) => this.replace(d), error: () => this.fail('save the idle rules of') });
  }

  protected spotName(spot: LockSpot) {
    return SPOT_NAMES[spot];
  }

  // A new widget is a clock in the middle while there is none yet, else the weather at the top right.
  protected addLock(display: DisplayInfo) {
    const widget: LockWidget = display.lockWidgets.some((w) => w.kind === 'clock')
      ? { kind: 'weather', spot: 'top-right' }
      : { kind: 'clock', spot: 'center' };
    this.saveLock(display, [...display.lockWidgets, widget]);
  }

  // A value starts on a temperature, the reading a lock screen shows most, or else on the first capability there is.
  protected setLockKind(display: DisplayInfo, index: number, kind: LockWidget['kind']) {
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

  protected setLockSpot(display: DisplayInfo, index: number, spot: LockSpot) {
    this.saveLock(display, display.lockWidgets.map((w, i) => (i === index ? { ...w, spot } : w)));
  }

  // The oldest Homey is the one a weather without an account shows.
  protected setLockAccount(display: DisplayInfo, index: number, account: string) {
    const id = Number(account);
    const chosen = id === this.homeys()[0]?.accountId ? null : id;
    this.saveLock(display, display.lockWidgets.map((w, i) => (i === index && w.kind === 'weather' ? { ...w, account: chosen } : w)));
  }

  protected setLockSignal(display: DisplayInfo, index: number, signal: string) {
    this.saveLock(display, display.lockWidgets.map((w, i) => (i === index && w.kind === 'value' ? { ...w, signal } : w)));
  }

  protected moveLock(display: DisplayInfo, index: number, by: -1 | 1) {
    const widgets = [...display.lockWidgets];
    [widgets[index], widgets[index + by]] = [widgets[index + by], widgets[index]];
    this.saveLock(display, widgets);
  }

  protected removeLock(display: DisplayInfo, index: number) {
    this.saveLock(display, display.lockWidgets.filter((_, i) => i !== index));
  }

  private saveLock(display: DisplayInfo, lockWidgets: LockWidget[]) {
    this.replace({ ...display, lockWidgets });
    this.api.setLockScreen(display.id, lockWidgets).subscribe({ next: (d) => this.replace(d), error: () => this.fail('save the lock screen of') });
  }

  // Named after its dashboard when the display offers more than one.
  protected behind(version: DashboardVersion, named: boolean) {
    const text = version.shownVersion
      ? `Shows version ${version.shownVersion} of ${version.latestVersion}`
      : 'Not showing it yet';
    if (!named) return text;
    return `${this.dashboardName(version.dashboardId)}: ${text[0].toLowerCase()}${text.slice(1)}`;
  }

  private save(display: DisplayInfo, dashboardIds: string[]) {
    this.api.assign(display.id, dashboardIds).subscribe({ next: (d) => this.replace(d), error: () => this.fail('assign') });
  }

  protected remove(display: DisplayInfo) {
    this.api.delete(display.id).subscribe({
      next: () => this.displays.update((list) => list.filter((d) => d.id !== display.id)),
      error: () => this.fail('remove'),
    });
  }

  private replace(display: DisplayInfo) {
    this.error.set(null);
    this.displays.update((list) => list.map((d) => (d.id === display.id ? display : d)));
  }

  private fail(what: string) {
    this.error.set(`Could not ${what} the display. Try again.`);
  }
}
