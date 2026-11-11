import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { PageHeader } from '../page-header';
import { DisplaySketch } from './display-sketch';
import { DisplayStatus } from './display-status';
import { DisplaysStore } from './displays-store';
import { TranslatePipe } from '@homey-dash/i18n';

const TABS = { dashboards: 'Dashboards', idle: 'When idle', lock: 'Lock screen' } as const;
type Tab = keyof typeof TABS;

/**
 * Every display, drawn as a screen with what it shows and how it is doing. Arriving from a task (`?then=idle`), it asks
 * which display and opens that page of it. Displays are added by running setup on a screen.
 */
@Component({
  selector: 'hd-displays-page',
  imports: [RouterLink, PageHeader, DisplaySketch, DisplayStatus, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sec-displays' },
  template: `
    <hd-page-header section="displays" [title]="'Displays' | t" />
    <div class="hd-page__body">
      @if (then(); as then) {
        <p class="hint" role="status">Pick the display whose {{ then === 'dashboards' ? 'dashboards' : then === 'idle' ? 'idle rules' : 'lock screen' }} you want to change.</p>
      }
      @if (store.loaded() && store.list().length === 0) {
        <div class="hd-empty hd-panel">
          <h2 class="hd-panel__title">{{ 'No displays yet' | t }}</h2>
          <p>{{ "Open HomeyDash's display address on a screen in the home. It asks for a name and then shows up here." | t }}</p>
        </div>
      }
      <ul class="grid">
        @for (display of store.list(); track display.id) {
          <li class="hd-panel cell">
            <a class="open" [routerLink]="['/displays', display.id, then() ?? 'details']" [attr.aria-label]="display.name">
              <hd-display-sketch [display]="display" [state]="false" />
            </a>
            <hd-display-status [display]="display" />
            <dl class="facts">
              <div><dt>{{ (display.dashboardIds.length === 1 ? 'dashboard' : 'dashboards') | t }}</dt><dd>{{ display.dashboardIds.length }}</dd></div>
              <div><dt>{{ (display.idleRules.length === 1 ? 'idle rule' : 'idle rules') | t }}</dt><dd>{{ display.idleRules.length }}</dd></div>
              <div><dt>{{ (display.lockWidgets.length === 1 ? 'lock widget' : 'lock widgets') | t }}</dt><dd>{{ display.lockWidgets.length }}</dd></div>
            </dl>
            <nav class="jump" [attr.aria-label]="'Pages of ' + display.name">
              @for (tab of tabs; track tab.id) {
                <a [routerLink]="['/displays', display.id, tab.id]" [class.is-next]="then() === tab.id">{{ tab.label }}</a>
              }
            </nav>
          </li>
        }
      </ul>
      @if (store.error(); as error) {
        <p class="hd-error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styles: `
    .hd-page__body { max-width: 1240px; }
    .hint { margin: 0; padding: 10px 14px; border-radius: var(--radius-control); background: color-mix(in oklab, var(--sec) 10%, var(--panel)); border: 1px solid color-mix(in oklab, var(--sec) 30%, var(--line)); font-weight: 500; }
    .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-4); }
    .cell { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); }
    .open { --screen-max: 240px; color: inherit; text-decoration: none; border-radius: 8px; }
    .open:focus-visible { outline: 3px solid var(--brand); outline-offset: 4px; }
    .facts { display: flex; flex-wrap: wrap; gap: 4px var(--space-4); margin: auto 0 0; padding-top: var(--space-3); border-top: 1px solid var(--line); }
    .facts div { display: flex; align-items: baseline; gap: 4px; white-space: nowrap; }
    .facts dt { order: 1; font-size: 13px; color: var(--ink-muted); }
    .facts dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
    .jump { display: flex; flex-wrap: wrap; gap: 4px var(--space-4); }
    .jump a { font-size: 13px; font-weight: 600; color: var(--brand); text-decoration: none; white-space: nowrap; }
    .jump a:hover, .jump a.is-next { text-decoration: underline; text-underline-offset: 3px; }
  `,
})
export class DisplaysPage {
  protected readonly store = inject(DisplaysStore);
  protected readonly tabs = (Object.keys(TABS) as Tab[]).map((id) => ({ id, label: TABS[id] }));
  protected readonly then = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(
      map((q) => {
        const then = q.get('then');
        return then && then in TABS ? (then as Tab) : null;
      }),
    ),
    { initialValue: null },
  );
}
