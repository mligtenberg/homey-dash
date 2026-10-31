import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ImmichAlbum, PhotoSetsApi } from '@homey-dash/api-client';
import { TileData } from '@homey-dash/tiles';
import { firstValueFrom } from 'rxjs';
import { albumLabel, loadAlbums, problem } from '../immich-albums';

/**
 * A photo tile's target: one of the photo sets, or a new one made here from an Immich album, so building a dashboard
 * never needs a trip to the Photo sets page.
 */
@Component({
  selector: 'hd-photo-set-field',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" for="tile-target">Photo set</label>
      @if (albums(); as albums) {
        <select id="tile-target" class="hd-select" (change)="create($any($event.target).value)" (keydown.escape)="cancel()">
          <option value="" selected>Choose an Immich album</option>
          @for (album of albums; track album.id) {
            <option [value]="album.id">{{ label(album) }}</option>
          }
        </select>
        <button class="hd-btn" type="button" (click)="cancel()">Cancel</button>
      } @else {
        <select id="tile-target" class="hd-select" (change)="choose($any($event.target).value)">
          @if (!value()) {
            <option value="" selected>Pick a photo set</option>
          } @else if (!selected()) {
            <option value="" selected>Photo set not found</option>
          }
          @for (set of sets(); track set.id) {
            <option [value]="set.target" [selected]="set.target === value()">
              {{ set.name }} ({{ set.photos.length }} {{ set.photos.length === 1 ? 'photo' : 'photos' }})
            </option>
          }
          <option value="new">New photo set from an album…</option>
        </select>
      }
      @if (selected()?.syncError; as syncError) {
        <span class="error" role="status">{{ syncError }}</span>
      }
      @if (error(); as error) {
        <span class="error" role="alert">{{ error }}</span>
      }
      <a class="hint" routerLink="/photo-sets">Manage photo sets</a>
    </div>
  `,
  styles: `
    .hint { font-size: 13px; color: var(--brand); }
    .error { font-size: 13px; color: var(--danger); font-weight: 700; }
  `,
})
export class PhotoSetField {
  readonly value = input.required<string | null>();
  readonly picked = output<string>();

  private readonly data = inject(TileData);
  private readonly api = inject(PhotoSetsApi);

  /** Immich's albums while a new photo set is being made, else null. */
  protected readonly albums = signal<ImmichAlbum[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly sets = computed(() =>
    [...this.data.photoSets().values()].sort((a, b) => a.name.localeCompare(b.name)),
  );
  protected readonly selected = computed(() => {
    const value = this.value();
    return value ? this.data.photoSets().get(value) : undefined;
  });

  protected label(album: ImmichAlbum) {
    return albumLabel(album);
  }

  protected async choose(value: string) {
    this.error.set(null);
    if (value !== 'new') {
      if (value) this.picked.emit(value);
      return;
    }
    const albums = await loadAlbums(this.api);
    if (typeof albums === 'string') this.error.set(albums);
    else this.albums.set(albums);
  }

  protected cancel() {
    this.albums.set(null);
  }

  // Makes a set named after the album and points the tile at it.
  protected async create(albumId: string) {
    if (!albumId) return;
    try {
      const set = await firstValueFrom(this.api.create(albumId));
      this.albums.set(null);
      this.picked.emit(set.target);
    } catch (e) {
      this.error.set(problem(e, 'Could not make the photo set. Try again.'));
    }
  }
}
