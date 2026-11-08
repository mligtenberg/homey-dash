import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideArrowDown, LucideArrowUp, LucideDynamicIcon, LucideX } from '@lucide/angular';

/**
 * The buttons beside an item in an ordered list: move it up, move it down, and (when `removable`) remove it. Their
 * labels name the item, such as "Move rule 2 up" and "Remove rule 2". They sit in the row they belong to.
 */
@Component({
  selector: 'hd-reorder-buttons',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <button type="button" class="hd-btn hd-btn--icon" [attr.aria-label]="'Move ' + label() + ' up'" [disabled]="first()" (click)="moved.emit(-1)">
      <svg [lucideIcon]="up" aria-hidden="true" />
    </button>
    <button type="button" class="hd-btn hd-btn--icon" [attr.aria-label]="'Move ' + label() + ' down'" [disabled]="last()" (click)="moved.emit(1)">
      <svg [lucideIcon]="down" aria-hidden="true" />
    </button>
    @if (removable()) {
      <button type="button" class="hd-btn hd-btn--icon" [attr.aria-label]="'Remove ' + label()" (click)="removed.emit()">
        <svg [lucideIcon]="remove" aria-hidden="true" />
      </button>
    }
  `,
})
export class ReorderButtons {
  /** What the item is called in the buttons' labels, such as `rule 2` or the name of a dashboard. */
  readonly label = input.required<string>();
  readonly first = input(false);
  readonly last = input(false);
  readonly removable = input(true);
  readonly moved = output<-1 | 1>();
  readonly removed = output<void>();

  protected readonly up = LucideArrowUp;
  protected readonly down = LucideArrowDown;
  protected readonly remove = LucideX;
}

/** A lone remove button that looks like those of `hd-reorder-buttons`, for an item that can't be moved. */
@Component({
  selector: 'hd-remove-button',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <button type="button" class="hd-btn hd-btn--icon" [attr.aria-label]="'Remove ' + label()" (click)="removed.emit()">
      <svg [lucideIcon]="remove" aria-hidden="true" />
    </button>
  `,
})
export class RemoveButton {
  readonly label = input.required<string>();
  readonly removed = output<void>();

  protected readonly remove = LucideX;
}
