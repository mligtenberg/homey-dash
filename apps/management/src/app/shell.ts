import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { RealtimeTileData } from '@homey-dash/tiles/data';
import { LucideDynamicIcon } from '@lucide/angular';
import { filter, map } from 'rxjs';
import { DashboardsStore } from './dashboards-store';
import { displayHealth } from './displays/display-sketch';
import { DisplaysStore } from './displays/displays-store';
import { GoTo } from './go-to';
import { SECTIONS, SectionId, sectionOf } from './sections';

/**
 * Management's frame: a sidebar that always lists the same five places, in the same order and colours, with what is
 * in each; the place you are in opens to show its items. Go to searches everything.
 */
@Component({
  selector: 'hd-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideDynamicIcon, GoTo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-app' },
  template: `
    <aside class="sidebar">
      <a class="brand" routerLink="/">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><rect x="9" y="13" width="6" height="4" rx=".5" /></svg>
        HomeyDash
      </a>
      <hd-go-to />
      <nav class="places" aria-label="Management">
        @for (place of sections; track place.id) {
          <a
            class="place sec-{{ place.id }}"
            [routerLink]="place.path"
            [attr.aria-current]="current() === place.id ? 'page' : null"
          >
            <span class="hd-mark"><svg [lucideIcon]="place.icon" /></span>
            <span class="place__label">{{ place.label }}</span>
            @if (marks()[place.id]; as mark) {
              <span class="attn" [title]="mark" role="img" [attr.aria-label]="mark"></span>
            }
            @if (counts()[place.id] !== null) {
              <span class="count">{{ counts()[place.id] }}</span>
            }
          </a>
          @if (current() === place.id && place.id === 'dashboards' && store.list().length) {
            <ul class="items sec-dashboards" aria-label="Dashboards">
              @for (dashboard of store.list(); track dashboard.id) {
                <li>
                  <a class="item" [routerLink]="['/dashboards', dashboard.id]" routerLinkActive ariaCurrentWhenActive="page">
                    <span class="item__name">{{ dashboard.name }}</span>
                    @if (dashboard.missingTiles > 0) {
                      <span class="attn" role="img" [attr.aria-label]="missingLabel(dashboard.missingTiles)" [title]="missingLabel(dashboard.missingTiles)"></span>
                    }
                    @if (dashboard.hasUnpublishedChanges) {
                      <span class="draft" role="img" aria-label="Unpublished changes" title="Unpublished changes"></span>
                    }
                  </a>
                </li>
              }
            </ul>
          }
          @if (current() === place.id && place.id === 'displays' && displays.list().length) {
            <ul class="items sec-displays" aria-label="Displays">
              @for (display of displays.list(); track display.id) {
                <li>
                  <a class="item" [routerLink]="['/displays', display.id]" routerLinkActive ariaCurrentWhenActive="page">
                    <span class="item__name">{{ display.name }}</span>
                    <span class="dot" [attr.data-tone]="tone(display)" role="img" [attr.aria-label]="health(display)" [title]="health(display)"></span>
                  </a>
                </li>
              }
            </ul>
          }
          @if (current() === place.id && place.id === 'photos' && displays.photoSets().length) {
            <ul class="items sec-photos" aria-label="Photo sets">
              @for (set of displays.photoSets(); track set.id) {
                <li>
                  <a class="item" [routerLink]="['/photo-sets', set.id]" routerLinkActive ariaCurrentWhenActive="page">
                    <span class="item__name">{{ set.name }}</span>
                  </a>
                </li>
              }
            </ul>
          }
        }
      </nav>
    </aside>
    <main class="page sec-{{ current() }}">
      @if (homeyNotSetUp() && current() !== 'accounts') {
        <div class="setup" role="status">
          <span>Homey isn't set up yet, so tiles show no devices, flows or moods.</span>
          <a class="hd-btn hd-btn--primary" routerLink="/accounts">Set up Homey</a>
        </div>
      }
      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: grid; grid-template-columns: 252px 1fr; min-height: 100dvh; }
    .sidebar {
      position: sticky; top: 0; height: 100dvh; box-sizing: border-box; overflow-y: auto;
      display: flex; flex-direction: column; gap: var(--space-4);
      padding: var(--space-5) var(--space-3);
      background: var(--sidebar); border-right: 1px solid var(--line);
    }
    .brand { display: flex; align-items: center; gap: 8px; padding: 0 6px; color: var(--ink); text-decoration: none; font-weight: 600; font-size: 17px; }
    .brand svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
    .places { display: flex; flex-direction: column; gap: 2px; }
    .place {
      display: flex; align-items: center; gap: 10px;
      padding: 6px 8px; border-radius: var(--radius-control);
      color: var(--ink-soft); text-decoration: none; font-weight: 500;
      transition: background-color .12s;
    }
    .place:hover { background: color-mix(in oklab, var(--sec) 7%, transparent); }
    .place[aria-current='page'] { background: var(--panel); color: var(--ink); font-weight: 600; box-shadow: inset 0 0 0 1px var(--line); }
    .place[aria-current='page'] .hd-mark { background: var(--sec); color: var(--panel); }
    .place:focus-visible, .item:focus-visible { outline: 3px solid var(--brand); outline-offset: 1px; }
    .place__label { flex: 1; }
    .count { font-size: 13px; color: var(--ink-muted); font-variant-numeric: tabular-nums; }
    .attn { width: 7px; height: 7px; border-radius: 50%; background: var(--warn); flex: none; }
    .items { list-style: none; margin: 2px 0 8px 21px; padding: 0 0 0 12px; border-left: 1px solid var(--line); display: flex; flex-direction: column; gap: 1px; }
    .item {
      display: flex; align-items: center; gap: 8px;
      padding: 5px 8px; border-radius: 5px;
      color: var(--ink-soft); text-decoration: none; font-size: 13px; font-weight: 500;
    }
    .item:hover { color: var(--ink); background: color-mix(in oklab, var(--sec) 7%, transparent); }
    .item[aria-current='page'] { color: var(--ink); font-weight: 600; background: color-mix(in oklab, var(--sec) 12%, transparent); }
    .item__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .draft { width: 7px; height: 7px; flex: none; box-sizing: border-box; border-radius: 50%; border: 1.5px solid var(--warn); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--line-strong); flex: none; }
    .dot[data-tone='ok'] { background: var(--ok); }
    .dot[data-tone='stale'], .dot[data-tone='lost'] { background: var(--warn); }
    .page { min-width: 0; }
    .setup { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-6); border-bottom: 1px solid var(--line); background: color-mix(in oklab, var(--warn) 9%, var(--panel)); color: var(--warn); font-weight: 600; }
    .setup .hd-btn { white-space: nowrap; }
    @media (max-width: 860px) {
      :host { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
      .sidebar { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); padding: var(--space-3) var(--space-4); border-right: 0; border-bottom: 1px solid var(--line); }
      hd-go-to { display: block; }
      .sidebar ::ng-deep .trigger { width: auto; }
      .places { flex-basis: 100%; flex-direction: row; overflow-x: auto; scrollbar-width: none; }
      .items, .count { display: none; }
      .place { flex: none; }
    }
    @media (prefers-reduced-motion: reduce) { .place { transition: none; } }
  `,
})
export class Shell {
  protected readonly store = inject(DashboardsStore);
  protected readonly displays = inject(DisplaysStore);
  private readonly router = inject(Router);
  private readonly homey = inject(RealtimeTileData);

  protected readonly sections = SECTIONS;
  protected readonly homeyNotSetUp = computed(() => this.homey.homeys()?.length === 0);
  protected readonly current = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => sectionOf(this.router.url)),
    ),
    { initialValue: sectionOf(this.router.url) },
  );

  protected readonly counts = computed<Record<SectionId, number | null>>(() => ({
    overview: null,
    dashboards: this.store.loaded() ? this.store.list().length : null,
    displays: this.displays.loaded() ? this.displays.list().length : null,
    photos: this.displays.photoSets().length || null,
    accounts: null,
  }));

  /** A dot beside a place where something needs you. */
  protected readonly marks = computed<Partial<Record<SectionId, string>>>(() => {
    const missing = this.store.list().filter((d) => d.missingTiles > 0).length;
    const idle = this.displays.list().filter((d) => !d.dashboardIds.length || !d.status.held).length;
    return {
      dashboards: missing ? `${missing} ${missing === 1 ? 'dashboard has' : 'dashboards have'} tiles not found in Homey` : undefined,
      displays: idle ? `${idle} ${idle === 1 ? 'display needs' : 'displays need'} attention` : undefined,
      accounts: this.homeyNotSetUp() ? 'Homey is not set up' : undefined,
    };
  });

  constructor() {
    this.store.load();
  }

  protected tone(display: Parameters<typeof displayHealth>[0]) {
    return displayHealth(display, this.displays).tone;
  }

  protected health(display: Parameters<typeof displayHealth>[0]) {
    return displayHealth(display, this.displays).text;
  }

  protected missingLabel(count: number) {
    return count === 1 ? '1 tile not found in Homey' : `${count} tiles not found in Homey`;
  }
}
