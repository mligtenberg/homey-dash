import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RealtimeTileData } from '@homey-dash/tiles/data';
import { LucideChevronRight, LucideTriangleAlert } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { DashboardsStore } from './dashboards-store';
import { DisplaySketch } from './displays/display-sketch';
import { DisplaysStore } from './displays/displays-store';
import { PageHeader } from './page-header';
import { section, TASKS } from './sections';

interface Attention {
  kind: 'Dashboard' | 'Display' | 'Account';
  sec: string;
  name: string;
  problem: string;
  action: string;
  link: unknown[];
}

/**
 * Where Management starts: what needs attention, every display drawn with what it shows, dashboards waiting to be
 * published, and the tasks people come here for, each leading to where it lives.
 */
@Component({
  selector: 'hd-home-page',
  imports: [RouterLink, PageHeader, DisplaySketch, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-page-header section="overview" title="Overview" />
    <div class="body">
      <div class="main">
        <section class="hd-panel block sec-displays" aria-labelledby="displays">
          <div class="block__head">
            <h2 class="hd-label" id="displays">Displays</h2>
            <span class="n">{{ displays.list().length }}</span>
            <a class="more" routerLink="/displays">All displays</a>
          </div>
          @if (displays.loaded() && !displays.list().length) {
            <p class="empty">No displays yet. Open HomeyDash's display address on a screen in the home; it asks for a name and then shows up here.</p>
          } @else {
            <ul class="screens">
              @for (display of displays.list(); track display.id) {
                <li><a class="screen-link" [routerLink]="['/displays', display.id]"><hd-display-sketch [display]="display" /></a></li>
              }
            </ul>
          }
        </section>
        <section class="hd-panel block sec-dashboards" aria-labelledby="drafts">
          <div class="block__head">
            <h2 class="hd-label" id="drafts">Unpublished changes</h2>
            <span class="n">{{ drafts().length }}</span>
          </div>
          @if (drafts().length) {
            <ul class="hd-rows">
              @for (dashboard of drafts(); track dashboard.id) {
                <li>
                  <a class="hd-row-link" [routerLink]="['/dashboards', dashboard.id]">
                    <span class="hd-key"></span>
                    <span class="hd-row-link__text">
                      <span class="hd-row-link__title">{{ dashboard.name }}</span>
                      <span class="hd-row-link__sub">{{ dashboard.publishedVersion ? 'Displays still show version ' + dashboard.publishedVersion : 'Never published' }}</span>
                      <span class="go-label">Review and publish</span>
                    </span>
                    <svg class="hd-row-link__go" [lucideIcon]="chevron" aria-hidden="true" />
                  </a>
                </li>
              }
            </ul>
          } @else {
            <p class="empty">Every dashboard is published. Displays show what you see in the editor.</p>
          }
        </section>
      </div>

      <div class="side">
        @if (attention().length) {
          <section class="hd-panel block" aria-labelledby="attention">
            <div class="block__head"><h2 class="hd-label" id="attention">Needs attention</h2><span class="n warn">{{ attention().length }}</span></div>
            <ul class="hd-rows">
              @for (item of attention(); track item.name + item.kind) {
                <li class="sec-{{ item.sec }}">
                  <a class="hd-row-link" [routerLink]="item.link">
                    <span class="hd-mark"><svg [lucideIcon]="alert" /></span>
                    <span class="hd-row-link__text">
                      <span class="hd-row-link__title">{{ item.name }}</span>
                      <span class="hd-row-link__sub">{{ item.kind }} · {{ item.problem }}</span>
                      <span class="go-label">{{ item.action }}</span>
                    </span>
                    <svg class="hd-row-link__go" [lucideIcon]="chevron" aria-hidden="true" />
                  </a>
                </li>
              }
            </ul>
          </section>
        }

        <section class="hd-panel block" aria-labelledby="tasks">
          <div class="block__head"><h2 class="hd-label" id="tasks">What do you want to do?</h2></div>
          <ul class="hd-rows">
            @for (task of tasks; track task.question) {
              <li class="sec-{{ task.section }}">
                <a class="hd-row-link" [routerLink]="task.path ?? place(task.section).path" [queryParams]="task.tab ? { then: task.tab } : null">
                  <span class="hd-key"></span>
                  <span class="hd-row-link__text">
                    <span class="hd-row-link__title">{{ task.question }}</span>
                    <span class="hd-row-link__sub">{{ task.route.join(' › ') }}</span>
                  </span>
                  <svg class="hd-row-link__go" [lucideIcon]="chevron" aria-hidden="true" />
                </a>
              </li>
            }
          </ul>
        </section>

      </div>
    </div>
  `,
  styles: `
    .body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 400px); gap: var(--space-5); padding: var(--space-6); align-items: start; max-width: 1360px; }
    .main, .side { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
    .block { overflow: hidden; }
    .block__head { display: flex; align-items: center; gap: var(--space-2); padding: 14px var(--space-4) 12px; border-bottom: 1px solid var(--line); }
    .n { font-size: 12px; font-weight: 600; color: var(--ink-muted); font-variant-numeric: tabular-nums; }
    .n.warn { color: var(--warn); }
    .more { margin-left: auto; font-size: 13px; font-weight: 600; color: var(--brand); text-decoration: none; }
    .more:hover { text-decoration: underline; text-underline-offset: 3px; }
    .go-label { margin-top: 2px; font-size: 13px; font-weight: 600; color: var(--brand); }
    .screens { list-style: none; margin: 0; padding: var(--space-5) var(--space-4); display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-5) var(--space-4); }
    .screen-link { display: block; color: inherit; text-decoration: none; border-radius: 8px; }
    .screen-link:focus-visible { outline: 3px solid var(--brand); outline-offset: 4px; }
    .empty { margin: 0; padding: var(--space-4); color: var(--ink-muted); text-wrap: pretty; }
    li[class^='sec-'] .hd-mark { --sec: var(--warn); }
    /* One column: what needs attention and the tasks come before the drawing of the displays. */
    @media (max-width: 1080px) { .body { grid-template-columns: 1fr; } .side { order: -1; } }
    @media (max-width: 560px) {
      .body { padding: var(--space-4); }
      .screens { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `,
})
export class HomePage {
  protected readonly store = inject(DashboardsStore);
  protected readonly displays = inject(DisplaysStore);
  private readonly homey = inject(RealtimeTileData);

  protected readonly tasks = TASKS;
  protected readonly chevron = LucideChevronRight;
  protected readonly alert = LucideTriangleAlert;
  protected readonly place = section;

  protected readonly drafts = computed(() => this.store.list().filter((d) => d.hasUnpublishedChanges));

  protected readonly attention = computed<Attention[]>(() => {
    const items: Attention[] = [];
    if (this.homey.homeys()?.length === 0) {
      items.push({ kind: 'Account', sec: 'accounts', name: 'Homey', problem: 'not set up, so tiles show no devices', action: 'Set up Homey', link: ['/accounts'] });
    }
    for (const d of this.store.list()) {
      if (d.missingTiles > 0) {
        const n = d.missingTiles;
        items.push({ kind: 'Dashboard', sec: 'dashboards', name: d.name, problem: `${n} ${n === 1 ? 'tile' : 'tiles'} not found in Homey`, action: 'Open dashboard', link: ['/dashboards', d.id] });
      }
    }
    for (const d of this.displays.list()) {
      if (!d.status.held) {
        items.push({ kind: 'Display', sec: 'displays', name: d.name, problem: 'its screen became another display', action: 'Open display', link: ['/displays', d.id] });
      } else if (!d.dashboardIds.length) {
        items.push({ kind: 'Display', sec: 'displays', name: d.name, problem: 'waiting for a dashboard', action: 'Choose dashboards', link: ['/displays', d.id, 'dashboards'] });
      } else if (d.status.connected && d.status.versions.some((v) => v.shownVersion !== v.latestVersion)) {
        items.push({ kind: 'Display', sec: 'displays', name: d.name, problem: 'shows an older version of a dashboard', action: 'Open display', link: ['/displays', d.id] });
      }
    }
    return items;
  });
}
