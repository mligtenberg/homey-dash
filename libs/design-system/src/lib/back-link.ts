import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideDynamicIcon } from '@lucide/angular';

/** A link back to the list a page belongs to, such as "Displays". The page names the destination in the content. */
@Component({
  selector: 'hd-back-link',
  imports: [RouterLink, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: inline-flex; }
    a { display: inline-flex; align-items: center; gap: 4px; color: var(--ink-muted); font: inherit; text-decoration: none; white-space: nowrap; }
    a:hover { color: var(--brand); }
    svg { width: 1em; height: 1em; }
  `,
  template: `<a [routerLink]="link()"><svg [lucideIcon]="arrow" aria-hidden="true" /><ng-content /></a>`,
})
export class BackLink {
  readonly link = input.required<string>();
  protected readonly arrow = LucideArrowLeft;
}
