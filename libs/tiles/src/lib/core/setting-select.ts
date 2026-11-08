import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** An option of a setting's select. */
export interface SettingOption {
  value: string | number;
  label: string;
}

/**
 * A tile setting that is a choice from a list: a labelled select. With an `emptyLabel` the first option has no value, such
 * as "Automatic", and is the one selected while `value` is empty. `picked` gives the chosen value as the select holds it,
 * a string, empty for that first option.
 */
@Component({
  selector: 'hd-setting-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" [for]="selectId()">{{ label() }}</label>
      <select [id]="selectId()" class="hd-select" (change)="picked.emit($any($event.target).value)">
        @if (emptyLabel(); as empty) {
          <option value="" [selected]="value() === '' || value() === undefined">{{ empty }}</option>
        }
        @for (option of options(); track option.value) {
          <option [value]="option.value" [selected]="option.value === value()">{{ option.label }}</option>
        }
      </select>
    </div>
  `,
})
export class SettingSelect {
  readonly label = input.required<string>();
  readonly selectId = input.required<string>();
  readonly options = input.required<readonly SettingOption[]>();
  readonly value = input<string | number | undefined>();
  readonly emptyLabel = input<string | null>(null);
  readonly picked = output<string>();
}
