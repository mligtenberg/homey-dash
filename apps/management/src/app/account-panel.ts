import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The frame of an account panel: a titled panel whose header carries a status pill (project it with
 * `<ng-container ngProjectAs="[status]">`) and whose last line is the error, when there is one.
 */
@Component({
  selector: 'hd-account-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <section
      class="hd-account hd-panel"
      [attr.aria-labelledby]="key() + '-title'"
    >
      <div class="hd-account__head">
        <h2 class="hd-panel__title" [id]="key() + '-title'">{{ title() }}</h2>
        <ng-content select="[status]" />
      </div>
      <ng-content />
      @if (error(); as error) {
        <p class="hd-error" role="alert">{{ error }}</p>
      }
    </section>
  `,
})
export class AccountPanel {
  /** Names the heading's id, so that the panel is labelled by its title. */
  readonly key = input.required<string>();
  readonly title = input.required<string>();
  readonly error = input<string | null>(null);
}
