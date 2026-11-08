import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * The question that replaces a Remove button until it is answered: what removing does, then Remove and Cancel. It lays
 * out as part of the row it sits in, so put it where the buttons were.
 */
@Component({
  selector: 'hd-confirm-inline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <span class="hd-muted">{{ message() }}</span>
    <button class="hd-btn hd-btn--danger" type="button" (click)="confirmed.emit()">{{ confirmLabel() }}</button>
    <button class="hd-btn" type="button" (click)="cancelled.emit()">Cancel</button>
  `,
})
export class ConfirmInline {
  /** What removing does. */
  readonly message = input.required<string>();
  readonly confirmLabel = input('Remove');
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
