import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiProblem, ImmichAccountApi, PhotoSetsApi } from '@homey-dash/api-client';
import { TileData } from '@homey-dash/tiles';
import { firstValueFrom } from 'rxjs';
import { AlbumSelect } from '../album-select';
import { AlbumGroup, loadAlbums, parseAlbumValue } from '../immich-albums';
import { TranslatePipe, t } from '@homey-dash/i18n';

/**
 * A photo tile's target: one of the photo sets, or a new one made here from an Immich album, so building a dashboard
 * never needs a trip to the Photo sets page. With several Immich accounts, the albums are grouped by account.
 */
@Component({
  selector: 'hd-photo-set-field',
  imports: [RouterLink, AlbumSelect, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" for="tile-target">{{ 'Photo set' | t }}</label>
      @if (groups(); as groups) {
        <hd-album-select selectId="tile-target" [placeholder]="'Choose an Immich album' | t" [groups]="groups" (picked)="create($event)" (cancelled)="cancel()" />
        <button class="hd-btn" type="button" (click)="cancel()">{{ 'Cancel' | t }}</button>
      } @else {
        <select id="tile-target" class="hd-select" (change)="choose($any($event.target).value)">
          @if (!value()) {
            <option value="" selected>{{ 'Pick a photo set' | t }}</option>
          } @else if (!selected()) {
            <option value="" selected>{{ 'Photo set not found' | t }}</option>
          }
          @for (set of sets(); track set.id) {
            <option [value]="set.target" [selected]="set.target === value()">
              {{ set.name }} ({{ set.photos.length }} {{ (set.photos.length === 1 ? 'photo' : 'photos') | t }})
            </option>
          }
          <option value="new">{{ 'New photo set from an album…' | t }}</option>
        </select>
      }
      @if (selected()?.syncError; as syncError) {
        <span class="hd-error hd-small" role="status">{{ syncError }}</span>
      }
      @if (error(); as error) {
        <span class="hd-error hd-small" role="alert">{{ error }}</span>
      }
      <a class="hint" routerLink="/photo-sets">{{ 'Manage photo sets' | t }}</a>
    </div>
  `,
  styles: `
    .hint { font-size: 13px; color: var(--brand); }
  `,
})
export class PhotoSetField {
  readonly value = input.required<string | null>();
  readonly picked = output<string>();

  private readonly data = inject(TileData);
  private readonly api = inject(PhotoSetsApi);
  private readonly accounts = inject(ImmichAccountApi);

  /** Every Immich account's albums while a new photo set is being made, else null. */
  protected readonly groups = signal<AlbumGroup[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly sets = computed(() =>
    [...this.data.photoSets().values()].sort((a, b) => a.name.localeCompare(b.name)),
  );
  protected readonly selected = computed(() => {
    const value = this.value();
    return value ? this.data.photoSets().get(value) : undefined;
  });

  protected async choose(value: string) {
    this.error.set(null);
    if (value !== 'new') {
      if (value) this.picked.emit(value);
      return;
    }
    const { groups, error } = await loadAlbums(this.accounts, this.api);
    this.error.set(error);
    if (groups.length) this.groups.set(groups);
  }

  protected cancel() {
    this.groups.set(null);
  }

  // Makes a set named after the album and points the tile at it.
  protected async create(value: string) {
    const album = parseAlbumValue(value);
    if (!album) return;
    try {
      const set = await firstValueFrom(this.api.create(album.accountId, album.albumId));
      this.groups.set(null);
      this.picked.emit(set.target);
    } catch (e) {
      this.error.set(apiProblem(e, t('Could not make the photo set. Try again.')));
    }
  }
}
