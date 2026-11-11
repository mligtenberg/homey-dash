import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@homey-dash/i18n';

/**
 * A row of buttons of which one is pressed: a choice between pages, windows or the values of a capability. The host
 * is the `hd-segmented` group, so it sits wherever the row does, such as in the head of the details dialog.
 */
@Component({
  selector: 'hd-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-segmented', role: 'group', '[attr.aria-label]': 'label()' },
  imports: [TranslatePipe],
  template: `
    @for (option of options(); track option.id) {
      <button type="button" [attr.aria-pressed]="value() === option.id" [disabled]="disabled()" (click)="picked.emit(option.id)">{{ option.label | t }}</button>
    }
  `,
})
export class Segmented<T> {
  readonly options = input.required<readonly { id: T; label: string }[]>();
  readonly value = input.required<T>();
  /** What the group is called, for assistive technology. */
  readonly label = input.required<string>();
  readonly disabled = input(false);
  readonly picked = output<T>();
}
