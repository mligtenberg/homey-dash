import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { apiProblem, ImmichAccount, ImmichAccountApi, ImmichAlbum, PhotoSelection, PhotoSet, PhotoSetsApi, photoUrl } from '@homey-dash/api-client';
import { PhotoViewer, RealtimeTileData } from '@homey-dash/tiles';
import { firstValueFrom } from 'rxjs';
import { AlbumGroup, albumLabel, albumValue, loadAlbums, parseAlbumValue } from './immich-albums';
import { defaultSelection, PhotoSelectionForm, selectionSummary } from './photo-selection-form';
import { clock, timeAgo } from '@homey-dash/design-system';

/**
 * One photo set (ADR-0008), kept current over the realtime connection: its name, the Immich album it follows or the
 * rules it draws photos by, when it last synced, the dashboards that show it, its photos and the photos excluded from
 * it on a display, which can be brought back. Sync now or Draw again syncs it in the background; while a sync runs, the set
 * is polled until it is done.
 */
@Component({
  selector: 'hd-photo-set-page',
  imports: [RouterLink, PhotoSelectionForm, PhotoViewer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="hd-page__header">
      <ol class="hd-crumbs" aria-label="You are here"><li><a routerLink="/photo-sets">Photo sets</a></li></ol>
      @if (set(); as set) {
        <input
          class="hd-input name"
          [attr.aria-label]="'Name of ' + set.name"
          [value]="set.name"
          (change)="rename(set, name.value)"
          (keydown.enter)="name.blur()"
          #name
        />
      }
    </header>
    <div class="hd-page__body">
      @if (set(); as set) {
        <section class="hd-panel panel" aria-label="Source">
          @if (set.selection; as selection) {
            <p class="hd-muted">{{ summary(selection) }}</p>
          }
          <p class="hd-muted">
            {{ set.photos.length }} {{ set.photos.length === 1 ? 'photo' : 'photos' }}
            @if (set.albumName) {
              from {{ set.albumName }}
            }
            @if (accounts().length > 1 && set.accountName) {
              in {{ set.accountName }}
            }
            @if (set.syncedAt) {
              · {{ set.selection ? 'drawn' : 'synced' }} {{ ago(set.syncedAt) }}
            }
            @if (set.skippedVideos) {
              · {{ set.skippedVideos }} {{ set.skippedVideos === 1 ? 'video' : 'videos' }} left out
            }
          </p>
          <p class="hd-muted">
            @if (set.dashboards.length) {
              Shown on {{ set.dashboards.join(', ') }}
            } @else {
              Not on any dashboard
            }
          </p>
          @if (busy()) {
            <p class="status" role="status">{{ set.selection ? 'Drawing photos…' : 'Syncing with Immich…' }}</p>
          } @else if (set.syncError; as syncError) {
            <p class="status failed" role="status">{{ syncError }}</p>
          }
          @if (changingAlbum()) {
            <select
              #other
              class="hd-select album"
              [attr.aria-label]="'Album of ' + set.name"
              (change)="changeAlbum(set, other.value)"
              (keydown.escape)="changingAlbum.set(false)"
            >
              @if (!groups()) {
                <option value="" selected>Loading albums…</option>
              } @else if (set.accountId === null) {
                <option value="" selected>Choose an album</option>
              }
              @for (group of groups(); track group.account.id) {
                @if (groups()!.length > 1) {
                  <optgroup [label]="group.account.name">
                    @for (option of group.albums; track option.id) {
                      <option [value]="value(group.account.id, option.id)" [selected]="isAlbumOf(set, group.account.id, option.id)">{{ label(option) }}</option>
                    }
                  </optgroup>
                } @else {
                  @for (option of group.albums; track option.id) {
                    <option [value]="value(group.account.id, option.id)" [selected]="isAlbumOf(set, group.account.id, option.id)">{{ label(option) }}</option>
                  }
                }
              }
            </select>
          }
          @if (editing()) {
            <form class="rules" (submit)="saveSelection($event, set)">
              @if (accounts().length > 1 || set.accountId === null) {
                <div class="hd-field">
                  <label class="hd-field__label" for="rules-account">Immich account</label>
                  <select id="rules-account" class="hd-select" (change)="editedAccount.set(+$any($event.target).value || null)">
                    @if (editedAccount() === null) {
                      <option value="" selected>Choose an account</option>
                    }
                    @for (account of accounts(); track account.id) {
                      <option [value]="account.id" [selected]="account.id === editedAccount()">{{ account.name }}</option>
                    }
                  </select>
                </div>
              }
              <hd-photo-selection-form [(selection)]="editedSelection" [accountId]="editedAccount()" />
              <div class="actions">
                <button class="hd-btn hd-btn--primary" type="submit">Save and draw</button>
                <button class="hd-btn" type="button" (click)="editing.set(false)">Cancel</button>
              </div>
            </form>
          }
          <div class="actions">
            @if (removing()) {
              <span class="hd-muted">{{ set.dashboards.length ? 'Its tiles show as missing.' : 'The album stays in Immich.' }}</span>
              <button class="hd-btn hd-btn--danger" type="button" (click)="remove(set)">Delete</button>
              <button class="hd-btn" type="button" (click)="removing.set(false)">Cancel</button>
            } @else {
              <button class="hd-btn hd-btn--primary" type="button" [disabled]="busy()" (click)="sync(set)">
                @if (set.selection) {
                  {{ busy() ? 'Drawing…' : 'Draw again' }}
                } @else {
                  {{ busy() ? 'Syncing…' : 'Sync now' }}
                }
              </button>
              @if (set.selection) {
                @if (!editing()) {
                  <button class="hd-btn" type="button" (click)="startEditing(set)">Edit rules</button>
                }
              } @else if (changingAlbum()) {
                <button class="hd-btn" type="button" (click)="changingAlbum.set(false)">Keep album</button>
              } @else {
                <button class="hd-btn" type="button" (click)="startChangingAlbum()">Change album</button>
              }
              <button class="hd-btn hd-btn--danger" type="button" (click)="removing.set(true)">Delete photo set</button>
            }
          </div>
        </section>

        @if (set.photos.length) {
          <section class="hd-panel panel" aria-label="Photos">
            <h2 class="hd-section-title">Photos</h2>
            <ul class="photos">
              @for (photo of set.photos; track photo.id) {
                <li>
                  <button type="button" class="photo" [attr.aria-label]="'Open photo ' + ($index + 1)" (click)="viewer.open($index)">
                    <img [src]="url(set, photo)" alt="" loading="lazy" />
                  </button>
                </li>
              }
            </ul>
            <hd-photo-viewer #viewer [set]="set" [photos]="set.photos" />
          </section>
        }

        @if (set.excluded.length) {
          <section class="hd-panel panel" [attr.aria-label]="'Excluded from ' + set.name">
            <h2 class="hd-section-title">Excluded</h2>
            <p class="hd-muted">
              {{ set.excluded.length }} {{ set.excluded.length === 1 ? 'photo' : 'photos' }} excluded on a display, which no
              sync brings back
              @if (set.selection) {
                · one brought back can be drawn again
              }
            </p>
            <ul class="photos">
              @for (id of set.excluded; track id; let i = $index) {
                <li class="excluded">
                  <img [src]="url(set, { id })" alt="" loading="lazy" />
                  <button
                    class="hd-btn hd-btn--sm"
                    type="button"
                    [attr.aria-label]="'Bring back excluded photo ' + (i + 1)"
                    [disabled]="restoring() === id"
                    (click)="restore(set, id)"
                  >
                    Bring back
                  </button>
                </li>
              }
            </ul>
          </section>
        }
      } @else if (data.photoSetsLoaded()) {
        <div class="hd-panel panel">
          <p class="hd-muted">This photo set no longer exists. <a routerLink="/photo-sets">Back to photo sets</a></p>
        </div>
      }
      @if (error(); as error) {
        <p class="hd-error" role="alert">
          {{ error }}
          @if (error.includes('Accounts')) {
            <a routerLink="/accounts">Go to Accounts</a>
          }
        </p>
      }
    </div>
  `,
  styles: `
    :host { --sec: var(--sec-photos); }
    .hd-page__header { gap: var(--space-2) var(--space-4); }
    .name { font-size: 20px; font-weight: 600; max-width: 420px; border-color: transparent; background: none; padding-inline: 8px; margin-left: -8px; }
    .name:hover, .name:focus { border-color: var(--line-strong); background: var(--panel); }
    .panel { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); }
    .album { max-width: 420px; }
    .rules { display: flex; flex-direction: column; gap: var(--space-4); max-width: 560px; }
    .status { margin: 0; font-weight: 700; }
    .status.failed { color: var(--danger); }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
    .photos { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .photos img { display: block; width: 96px; height: 96px; object-fit: cover; border-radius: 6px; background: var(--tile-surface); }
    .photo { display: block; padding: 0; border: 0; background: none; border-radius: 6px; cursor: zoom-in; }
    .excluded { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  `,
})
export class PhotoSetPage {
  readonly id = input.required<string>();

  protected readonly data = inject(RealtimeTileData);
  private readonly api = inject(PhotoSetsApi);
  private readonly accountsApi = inject(ImmichAccountApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly set = computed(() => [...this.data.photoSets().values()].find((s) => s.id === this.id()));
  protected readonly accounts = signal<ImmichAccount[]>([]);
  /** Every Immich account's albums, once asked for. */
  protected readonly groups = signal<AlbumGroup[] | null>(null);
  protected readonly editing = signal(false);
  protected readonly editedAccount = signal<number | null>(null);
  protected readonly editedSelection = signal<PhotoSelection>(defaultSelection());
  protected readonly changingAlbum = signal(false);
  /** Asked for a sync, or polling until one is done. */
  protected readonly syncing = signal(false);
  protected readonly busy = computed(() => this.syncing() || !!this.set()?.syncing);
  protected readonly restoring = signal<string | null>(null);
  protected readonly removing = signal(false);
  protected readonly error = signal<string | null>(null);

  // Ticks so "synced … ago" stays true while the page is open.
  private readonly now = clock(30_000);

  constructor() {
    this.accountsApi.list().subscribe({
      next: ({ accounts }) => this.accounts.set(accounts),
      error: (e) => this.error.set(apiProblem(e, 'Could not load the Immich accounts. Try again.')),
    });
    // A set that arrives syncing, such as one just added or changed, is polled until it is done.
    effect(() => {
      const set = this.set();
      if (set?.syncing) untracked(() => this.waitFor(set.id));
    });
  }

  protected url(set: PhotoSet, photo: Pick<PhotoSet['photos'][number], 'id'>) {
    return photoUrl(set, photo);
  }

  protected label(album: ImmichAlbum) {
    return albumLabel(album);
  }

  protected value(accountId: number, albumId: string) {
    return albumValue(accountId, albumId);
  }

  protected isAlbumOf(set: PhotoSet, accountId: number, albumId: string) {
    return set.accountId === accountId && set.albumId === albumId;
  }

  protected summary(selection: PhotoSelection) {
    return selectionSummary(selection);
  }

  protected ago(iso: string) {
    return timeAgo(iso, this.now());
  }

  protected startEditing(set: PhotoSet) {
    if (!set.selection) return;
    this.editedSelection.set(set.selection);
    this.editedAccount.set(set.accountId);
    this.editing.set(true);
  }

  protected saveSelection(event: Event, set: PhotoSet) {
    event.preventDefault();
    const accountId = this.editedAccount();
    if (accountId === null) {
      this.error.set('Choose an Immich account for the photo set.');
      return;
    }
    this.api.update(set.id, { selection: this.editedSelection(), accountId }).subscribe({
      next: (changed) => {
        this.editing.set(false);
        this.error.set(null);
        if (changed.syncing) this.waitFor(changed.id);
      },
      error: (e) => this.error.set(apiProblem(e, 'Could not save the rules. Try again.')),
    });
  }

  protected async startChangingAlbum() {
    this.changingAlbum.set(true);
    const { groups, error } = await loadAlbums(this.accountsApi, this.api);
    this.error.set(error);
    this.groups.set(groups);
  }

  protected async sync(set: PhotoSet) {
    this.syncing.set(true);
    try {
      // Accepted at once; a sync that fails says why on the set itself.
      await firstValueFrom(this.api.sync(set.id));
      await this.poll(set.id);
      this.error.set(null);
    } catch (e) {
      this.error.set(apiProblem(e, 'Could not sync the photo set. Try again.'));
    } finally {
      this.syncing.set(false);
    }
  }

  // Unless already asked for a sync, or polling.
  private async waitFor(id: string) {
    if (this.syncing()) return;
    this.syncing.set(true);
    try {
      await this.poll(id);
    } catch (e) {
      this.error.set(apiProblem(e, 'Could not sync the photo set. Try again.'));
    } finally {
      this.syncing.set(false);
    }
  }

  // Stops when the page closes.
  private poll(id: string) {
    return firstValueFrom(this.api.untilSynced(id).pipe(takeUntilDestroyed(this.destroyRef)), { defaultValue: null });
  }

  protected async restore(set: PhotoSet, photoId: string) {
    this.restoring.set(photoId);
    try {
      await firstValueFrom(this.api.restore(set, photoId));
      this.error.set(null);
    } catch (e) {
      this.error.set(apiProblem(e, 'Could not bring the photo back. Try again.'));
    } finally {
      this.restoring.set(null);
    }
  }

  // An album of another account moves the set to that account.
  protected changeAlbum(set: PhotoSet, value: string) {
    const album = parseAlbumValue(value);
    if (!album || this.isAlbumOf(set, album.accountId, album.albumId)) return;
    this.changingAlbum.set(false);
    this.api.update(set.id, album).subscribe({
      next: (changed) => changed.syncing && this.waitFor(changed.id),
      error: (e) => this.error.set(apiProblem(e, 'Could not change the album. Try again.')),
    });
  }

  protected rename(set: PhotoSet, name: string) {
    if (!name.trim() || name.trim() === set.name) return;
    this.api.update(set.id, { name: name.trim() }).subscribe({ error: () => this.error.set('Could not rename the photo set. Try again.') });
  }

  protected remove(set: PhotoSet) {
    this.api.delete(set.id).subscribe({
      next: () => this.router.navigate(['/photo-sets']),
      error: () => this.error.set('Could not delete the photo set. Try again.'),
    });
  }
}
