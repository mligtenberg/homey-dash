import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { LucideDynamicIcon, LucideIconInput, LucideX } from '@lucide/angular';

/** How long the detail view stays open untouched; nobody may be there to close it on a wall tablet. */
export const DETAILS_IDLE_MS = 60_000;

/**
 * A tile's detail view: a modal over the whole screen with the projected content, the target's full controls,
 * below its name and `subtitle`. It goes inside the tile, so it takes the tile's kind hue; the content renders
 * only while it is open.
 */
@Component({
  selector: 'hd-tile-details',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Not a box of its own, so it does not take part in the tile's layout.
  host: { style: 'display: contents' },
  template: `
    <dialog
      #dialog
      class="hd-details"
      [class.hd-details--fill]="fill()"
      [class.hd-details--screen]="screen()"
      tabindex="-1"
      [attr.aria-label]="name()"
      (close)="onClose()"
      (pointerdown)="onPointerDown($event)"
      (keydown)="keepOpen()"
      (click)="onClick($event)"
    >
      @if (isOpen()) {
        <div class="hd-details__panel">
          <div class="hd-details__head">
            <svg class="hd-icon" [lucideIcon]="icon()" />
            <div class="hd-details__titles">
              <h2 class="hd-details__name">{{ name() }}</h2>
              <div class="hd-details__sub">{{ subtitle() }}</div>
            </div>
            <ng-content select="[hdDetailsHead]" />
            <button type="button" class="hd-round-btn hd-details__close" aria-label="Close" autofocus (click)="close()">
              <svg [lucideIcon]="closeIcon" />
            </button>
          </div>
          <ng-content />
        </div>
      }
    </dialog>
  `,
})
export class TileDetails {
  readonly name = input.required<string>();
  readonly icon = input.required<LucideIconInput>();
  readonly subtitle = input('');
  /** Whether it takes the whole screen, its content full-bleed under the head, such as for a photo. */
  readonly fill = input(false);
  /** Whether it takes the whole screen but keeps the theme, its content scrolling under the head and tabs. */
  readonly screen = input(false);
  /** Whether a tap on the backdrop closes it. */
  readonly closeOnBackdrop = input(true);

  /** Emits when it closed, however: its button, Escape, the backdrop or going idle. */
  readonly closed = output<void>();

  readonly isOpen = signal(false);
  protected readonly closeIcon = LucideX;

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private idleTimer?: ReturnType<typeof setTimeout>;
  private downOnBackdrop = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.idleTimer));
  }

  open() {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) return;
    this.isOpen.set(true);
    dialog.showModal();
    this.keepOpen();
  }

  close() {
    this.dialog().nativeElement.close();
  }

  // Also after Escape, which closes the dialog by itself.
  protected onClose() {
    this.isOpen.set(false);
    clearTimeout(this.idleTimer);
    this.closed.emit();
  }

  protected keepOpen() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), DETAILS_IDLE_MS);
  }

  protected onPointerDown(event: PointerEvent) {
    this.downOnBackdrop = event.target === event.currentTarget;
    this.keepOpen();
  }

  // The panel fills the dialog, so a click on the dialog itself is on the backdrop. A drag that started on a
  // control, such as the slider, may end there too; that is not a tap outside.
  protected onClick(event: Event) {
    if (this.closeOnBackdrop() && event.target === event.currentTarget && this.downOnBackdrop) this.close();
    this.downOnBackdrop = false;
  }
}
