import { ChangeDetectionStrategy, Component, ElementRef, input, model, output, viewChild } from '@angular/core';
import { LucideDynamicIcon, LucideIconInput } from '@lucide/angular';
import { KindHue } from '@homey-dash/tiles';
import { TranslatePipe } from '@homey-dash/i18n';

/**
 * The shell both pickers share: a trigger that looks like a select, and a dialog with a search, the groups to pick
 * from (projected with `pickerNav`) and what is in the picked one (the rest of the content). Press Enter in the search
 * to pick the first that shows (`enter`). The picker sets itself up on `opening`, then calls `open()`.
 */
@Component({
  selector: 'hd-picker-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [TranslatePipe],
  template: `
    <button
      type="button"
      class="hd-select hd-picker__trigger"
      [id]="triggerId()"
      [attr.aria-label]="triggerLabel()"
      [class.is-placeholder]="placeholder()"
      (click)="opening.emit()"
    >
      {{ summary() }}
    </button>

    <dialog #dialog class="hd-panel hd-picker" [attr.aria-label]="label()" closedby="any" (close)="query.set('')">
      <div class="hd-picker__head">
        <input
          #search
          class="hd-input"
          type="search"
          [placeholder]="searchLabel()"
          [attr.aria-label]="searchLabel()"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
          (keydown.enter)="$event.preventDefault(); enter.emit()"
        />
        <button type="button" class="hd-btn" (click)="close()">{{ 'Cancel' | t }}</button>
      </div>

      <div class="hd-picker__body">
        <nav class="hd-picker__nav" [attr.aria-label]="navLabel()"><ng-content select="[pickerNav]" /></nav>
        <div class="hd-picker__list"><ng-content /></div>
      </div>
    </dialog>
  `,
})
export class PickerDialog {
  /** What the trigger shows: the picked item, or what to do when there is none. */
  readonly summary = input.required<string>();
  readonly placeholder = input(false);
  readonly triggerId = input<string | null>(null);
  readonly triggerLabel = input<string | null>(null);
  /** The dialog's name, such as "Pick a device". */
  readonly label = input.required<string>();
  readonly searchLabel = input.required<string>();
  readonly navLabel = input.required<string>();
  readonly query = model('');
  readonly opening = output<void>();
  readonly enter = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');

  /** Opens with the search focused and the current group and item scrolled into view. */
  open() {
    const dialog = this.dialog().nativeElement;
    dialog.showModal();
    this.search().nativeElement.focus();
    setTimeout(() => dialog.querySelectorAll('[aria-current="true"]').forEach((el) => el.scrollIntoView({ block: 'center' })));
  }

  close() {
    this.dialog().nativeElement.close();
  }
}

/** One item in a picker: its icon on its kind's colour, its name, what it is, and how many it holds when it is a group. */
@Component({
  selector: 'hd-picker-row',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <button
      type="button"
      class="hd-picker__row"
      [attr.aria-current]="current()"
      [style.--k-ink]="'var(--kind-' + hue() + '-ink)'"
      [style.--k-fill]="'var(--kind-' + hue() + '-fill)'"
      (click)="pressed.emit()"
    >
      <span class="hd-picker__icon"><svg class="hd-icon" [lucideIcon]="icon()" /></span>
      <span class="hd-picker__text">
        <span class="hd-picker__name">{{ name() }}</span>
        <span class="hd-picker__type">{{ detail() }}</span>
      </span>
      @if (count() !== null) {
        <span class="hd-picker__count">{{ count() }}</span>
      }
    </button>
  `,
})
export class PickerRow {
  readonly icon = input.required<LucideIconInput>();
  readonly hue = input.required<KindHue>();
  readonly name = input.required<string>();
  readonly detail = input('');
  readonly count = input<number | null>(null);
  /** Whether it is the one picked now. */
  readonly current = input(false);
  readonly pressed = output<void>();
}
