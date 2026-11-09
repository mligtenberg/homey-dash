import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideChevronRight, LucideMonitor } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { DisplayStatus } from './display-status';
import { DisplaysStore } from './displays-store';

/** Every display at a glance, each opening to its own pages. Displays are added by running setup on a screen. */
@Component({
  selector: 'hd-displays-page',
  imports: [RouterLink, DisplayStatus, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="hd-page__header">
      <h1 class="hd-page__title">Displays</h1>
    </header>
    <div class="hd-page__body">
      <p class="hd-lead">Each screen in the home is a display. Open one to see how it is doing, choose what it shows, and set what it does when left alone.</p>
      @if (store.loaded() && store.list().length === 0) {
        <div class="hd-empty hd-panel">
          <h2 class="hd-panel__title">No displays yet</h2>
          <p>Open HomeyDash's display address on a screen in the home. It asks for a name and then shows up here.</p>
        </div>
      }
      <div class="grid">
        @for (display of store.list(); track display.id) {
          <a class="card hd-panel" [routerLink]="['/displays', display.id]">
            <div class="card__head">
              <span class="hd-icon-tile" aria-hidden="true"><svg [lucideIcon]="monitor" /></span>
              <h2 class="hd-panel__title">{{ display.name }}</h2>
              <svg class="card__go" [lucideIcon]="chevron" aria-hidden="true" />
            </div>
            <hd-display-status [display]="display" />
            <ul class="facts">
              <li><strong>{{ display.dashboardIds.length }}</strong> {{ display.dashboardIds.length === 1 ? 'dashboard' : 'dashboards' }}</li>
              <li><strong>{{ display.idleRules.length }}</strong> idle {{ display.idleRules.length === 1 ? 'rule' : 'rules' }}</li>
              <li><strong>{{ display.lockWidgets.length }}</strong> lock {{ display.lockWidgets.length === 1 ? 'widget' : 'widgets' }}</li>
            </ul>
          </a>
        }
      </div>
      @if (store.error(); as error) {
        <p class="hd-error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styles: `
    .hd-page__body { max-width: none; }
    .hd-empty { max-width: 640px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-3); }
    .card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); color: inherit; text-decoration: none; transition: border-color .15s, box-shadow .15s; }
    .card:hover, .card:focus-visible { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
    .card__head { display: flex; align-items: center; gap: var(--space-3); }
    .card__head h2 { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card__go { width: 18px; height: 18px; color: var(--ink-muted); }
    .facts { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); margin: 0; padding: var(--space-3) 0 0; border-top: 1px solid var(--line); list-style: none; color: var(--ink-muted); font-size: 13px; }
    .facts strong { color: var(--ink); font-variant-numeric: tabular-nums; }
  `,
})
export class DisplaysPage {
  protected readonly store = inject(DisplaysStore);
  protected readonly monitor = LucideMonitor;
  protected readonly chevron = LucideChevronRight;

}
