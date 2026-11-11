import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TILE_SIZE_LABELS, TILE_SIZES, TileSize } from '@homey-dash/layout';
import { TranslatePipe } from '@homey-dash/i18n';

/** The tile sizes; the ones the kind lacks or that do not fit are disabled, not hidden. */
@Component({
  selector: 'hd-size-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div class="hd-sizes" role="group" [attr.aria-label]="'Size' | t">
      @for (size of sizes; track size) {
        <button
          type="button"
          [attr.aria-pressed]="size === value()"
          [disabled]="!enabled()(size)"
          (click)="picked.emit(size)"
        >
          <svg viewBox="0 0 30 40" aria-hidden="true">
            <rect x="0" y="0" width="30" height="40" rx="3" opacity=".2" />
            <rect x="0" y="0" [attr.width]="spans[size].columns * 10" [attr.height]="spans[size].rows * 10" rx="3" />
          </svg>
          {{ labels[size] }}
        </button>
      }
    </div>
  `,
})
export class SizePicker {
  readonly value = input.required<TileSize>();
  readonly enabled = input.required<(size: TileSize) => boolean>();
  readonly picked = output<TileSize>();

  protected readonly sizes = Object.keys(TILE_SIZES) as TileSize[];
  protected readonly spans = TILE_SIZES;
  protected readonly labels = TILE_SIZE_LABELS;
}
