import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@homey-dash/i18n';

export interface PageTab {
  /** Route of the tab, relative to the page that holds the strip. */
  path: string;
  label: string;
  /** What the tab holds, so the right one is found without opening them all. */
  hint: string;
}

/**
 * The strip of tabs under a page header: each tab names itself and says what it holds. The underline takes the
 * place's colour, so the page must set `--sec`.
 */
@Component({
  selector: 'hd-page-tabs',
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="tabs" [attr.aria-label]="label() | t">
      @for (tab of tabs(); track tab.path) {
        <a class="tab" [routerLink]="tab.path" routerLinkActive ariaCurrentWhenActive="page"><span class="tab__label">{{ tab.label | t }}</span><small>{{ tab.hint | t }}</small></a>
      }
    </nav>
  `,
  styles: `
    :host { display: block; }
    .tabs { display: flex; gap: var(--space-1); padding: 0 var(--space-6); background: var(--panel); border-bottom: 1px solid var(--line); overflow-x: auto; }
    .tab { display: flex; flex-direction: column; padding: 8px 14px 10px; color: var(--ink-soft); font-weight: 600; text-decoration: none; white-space: nowrap; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tab small { font-size: 12px; font-weight: 500; color: var(--ink-muted); }
    .tab:hover { color: var(--ink); }
    .tab[aria-current='page'] { color: var(--ink); border-bottom-color: var(--sec); }
    .tab:focus-visible { outline: 3px solid var(--brand); outline-offset: -3px; border-radius: 6px; }
    @media (max-width: 860px) { .tabs { padding: 0 var(--space-4); } }
  `,
})
export class PageTabs {
  readonly tabs = input.required<readonly PageTab[]>();
  /** Names the strip for screen readers. */
  readonly label = input.required<string>();
}
