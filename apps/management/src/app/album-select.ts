import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { AlbumGroup, albumLabel, albumValue } from './immich-albums';

/**
 * A select of Immich albums, grouped by account when there are several. `picked` gives the album's value, which
 * `parseAlbumValue` reads; the first option is the `placeholder`, which has an empty value.
 */
@Component({
  selector: 'hd-album-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <select
      #select
      [id]="selectId()"
      class="hd-select"
      (change)="picked.emit(select.value)"
      (keydown.escape)="cancelled.emit()"
    >
      <option value="" selected>{{ placeholder() }}</option>
      @for (group of groups(); track group.account.id) {
        @if (groups().length > 1) {
          <optgroup [label]="group.account.name">
            @for (album of group.albums; track album.id) {
              <option [value]="value(group, album.id)">
                {{ label(album) }}
              </option>
            }
          </optgroup>
        } @else {
          @for (album of group.albums; track album.id) {
            <option [value]="value(group, album.id)">{{ label(album) }}</option>
          }
        }
      }
    </select>
  `,
})
export class AlbumSelect {
  readonly groups = input.required<readonly AlbumGroup[]>();
  readonly selectId = input.required<string>();
  readonly placeholder = input('Choose an album');
  readonly picked = output<string>();
  readonly cancelled = output<void>();

  private readonly select =
    viewChild.required<ElementRef<HTMLSelectElement>>('select');

  focus() {
    this.select().nativeElement.focus();
  }

  protected readonly label = albumLabel;
  protected readonly value = (group: AlbumGroup, albumId: string) =>
    albumValue(group.account.id, albumId);
}
