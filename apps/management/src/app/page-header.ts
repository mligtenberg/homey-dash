import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideDynamicIcon } from '@lucide/angular';
import { section, SectionId } from './sections';

export interface Crumb {
  label: string;
  link: string | unknown[];
}

/**
 * Every page's header, laid out the same way: where it sits (its place in Management, then any parents), its title
 * beside the place's mark, a line on what the page is for, and its actions on the right.
 */
@Component({
  selector: 'hd-page-header',
  imports: [RouterLink, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-page__header', '[style.--sec]': '"var(--sec-" + section() + ")"' },
  template: `
    @if (crumbs().length) {
      <ol class="hd-crumbs" aria-label="You are here">
        @for (crumb of crumbs(); track $index) {
          <li><a [routerLink]="crumb.link">{{ crumb.label }}</a></li>
        }
      </ol>
    }
    <span class="hd-mark hd-mark--lg" aria-hidden="true"><svg [lucideIcon]="place().icon" /></span>
    <div class="titles">
      <div class="title-row">
        <h1 class="hd-page__title">{{ title() }}</h1>
        <ng-content select="[status]" />
      </div>
      @if (purpose() !== null) {
        <p class="purpose">{{ purpose() ?? place().purpose }}</p>
      }
    </div>
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host { display: flex; flex-wrap: wrap; align-items: center; column-gap: var(--space-3); }
    .titles { flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .title-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
    .purpose { margin: 0; font-size: 13px; color: var(--ink-muted); text-wrap: pretty; max-width: 72ch; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .actions:empty { display: none; }
    .hd-crumbs { margin-bottom: 2px; }
  `,
})
export class PageHeader {
  readonly section = input.required<SectionId>();
  readonly title = input.required<string>();
  /** Parents above this page, the place first. */
  readonly crumbs = input<Crumb[]>([]);
  /** The line under the title: the place's purpose when left out, none when null. */
  readonly purpose = input<string | null | undefined>(undefined);
  protected readonly place = computed(() => section(this.section()));
}
