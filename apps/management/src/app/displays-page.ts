import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DashboardVersion, DisplayInfo, DisplaysApi, Realtime } from '@homey-dash/api-client';
import { DashboardsStore } from './dashboards-store';

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
 * Every display, with its main dashboard, the others it offers on its tape, and its display status, kept current
 * over the realtime connection. Displays are added by running setup on a screen.
 */
@Component({
  selector: 'hd-displays-page',
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
          <div class="hd-field">
            <label class="hd-field__label" [for]="'dashboard-' + display.id">Main dashboard</label>
            <select class="hd-select" [id]="'dashboard-' + display.id" (change)="assign(display, dashboard.value)" #dashboard>
              <option value="" [selected]="!display.dashboardId">None (waiting)</option>
              @for (option of dashboards(); track option.id) {
                <option [value]="option.id" [selected]="option.id === display.dashboardId" [disabled]="!option.published">
                  {{ option.name }}{{ option.published ? '' : ' (not published)' }}
                </option>
              }
            </select>
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
            @if (!display.dashboardId) {
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
          @if (display.dashboardId) {
            <fieldset class="others">
              <legend class="hd-field__label">Also on its tape</legend>
              @for (option of offerable(display); track option.id) {
                <label class="hd-check">
                  <input
                    type="checkbox"
                    [checked]="display.otherDashboardIds.includes(option.id)"
                    (change)="offer(display, option.id, check.checked)"
                    #check
                  />
                  {{ option.name }}
                </label>
              } @empty {
                <span class="hint">Publish another dashboard to offer it here.</span>
              }
            </fieldset>
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
    .display { display: grid; grid-template-columns: 1fr 1fr auto auto; align-items: end; gap: var(--space-4); padding: var(--space-4); }
    .status { display: flex; flex-wrap: wrap; gap: var(--space-2); padding-bottom: 6px; white-space: nowrap; }
    .remove { padding-bottom: 10px; }
    .others { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); margin: 0; padding: 0; border: 0; }
    .others legend { padding: 0; margin-bottom: var(--space-2); }
    .hint { color: var(--ink-muted); }
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

  protected readonly displays = signal<DisplayInfo[]>([]);
  protected readonly loaded = signal(false);
  protected readonly removing = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
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

  // Others need a main dashboard, so they go when it does.
  protected assign(display: DisplayInfo, dashboardId: string) {
    this.save(display, dashboardId || null, dashboardId ? display.otherDashboardIds : []);
  }

  // The others are kept in the order dashboards are listed, which is the order the tape shows them in.
  protected offer(display: DisplayInfo, dashboardId: string, offered: boolean) {
    const others = new Set(display.otherDashboardIds);
    if (offered) others.add(dashboardId);
    else others.delete(dashboardId);
    const ordered = this.dashboards().map((d) => d.id).filter((id) => others.has(id));
    this.save(display, display.dashboardId, ordered);
  }

  // The published dashboards it can offer besides its main one.
  protected offerable(display: DisplayInfo) {
    return this.dashboards().filter((d) => d.published && d.id !== display.dashboardId);
  }

  // Named after its dashboard when the display offers more than one.
  protected behind(version: DashboardVersion, named: boolean) {
    const text = version.shownVersion
      ? `Shows version ${version.shownVersion} of ${version.latestVersion}`
      : 'Not showing it yet';
    if (!named) return text;
    const name = this.dashboards().find((d) => d.id === version.dashboardId)?.name ?? 'Dashboard';
    return `${name}: ${text[0].toLowerCase()}${text.slice(1)}`;
  }

  private save(display: DisplayInfo, dashboardId: string | null, others: string[]) {
    this.api.assign(display.id, dashboardId, others).subscribe({ next: (d) => this.replace(d), error: () => this.fail('assign') });
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
