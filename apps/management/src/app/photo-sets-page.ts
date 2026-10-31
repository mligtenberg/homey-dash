import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ImmichAccount, ImmichAccountApi, ImmichAlbum, PhotoSelection, PhotoSet, PhotoSetsApi, photoUrl } from '@homey-dash/api-client';
import { RealtimeTileData } from '@homey-dash/tiles';
import { firstValueFrom } from 'rxjs';
import { timeAgo } from './displays-page';
import { AlbumGroup, albumLabel, albumValue, loadAlbums, parseAlbumValue, problem } from './immich-albums';
import { defaultSelection, PhotoSelectionForm, selectionSummary } from './photo-selection-form';

/**
 * Every photo set (ADR-0008), kept current over the realtime connection: the Immich album it follows or the rules it
 * draws photos by, its photos, when it last synced and the dashboards that show it. HomeyDash syncs albums every 15
 * minutes and draws again as each set's rules say; Sync now or Draw again does it at once. With several Immich
 * accounts, each set says which one it draws from, and albums are grouped by account.
 */
@Component({
  selector: 'hd-photo-sets-page',
  imports: [RouterLink, PhotoSelectionForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header">
      <h1>Photo sets</h1>
      @if (!adding()) {
        <button class="hd-btn hd-btn--primary" type="button" (click)="startAdding()">New photo set</button>
      }
    </header>
    <div class="body">
      @if (adding()) {
        <div class="hd-panel new-panel">
          <div class="source" role="radiogroup" aria-label="Photos from">
            <button type="button" class="hd-btn" role="radio" [attr.aria-checked]="source() === 'album'" [class.hd-btn--primary]="source() === 'album'" (click)="source.set('album')">
              An album
            </button>
            <button type="button" class="hd-btn" role="radio" [attr.aria-checked]="source() === 'rules'" [class.hd-btn--primary]="source() === 'rules'" (click)="startRules()">
              At random, by rules
            </button>
          </div>
          @if (source() === 'album') {
            <form class="new" (submit)="create($event, album.value, newName.value)">
              <div class="hd-field">
                <label class="hd-field__label" for="new-album">Immich album</label>
                <select #album id="new-album" class="hd-select" (change)="chosenAlbum.set(album.value)" (keydown.escape)="adding.set(false)">
                  <option value="" selected>{{ groups() ? 'Choose an album' : 'Loading albums…' }}</option>
                  @for (group of groups(); track group.account.id) {
                    @if (groups()!.length > 1) {
                      <optgroup [label]="group.account.name">
                        @for (option of group.albums; track option.id) {
                          <option [value]="value(group.account.id, option.id)">{{ label(option) }}</option>
                        }
                      </optgroup>
                    } @else {
                      @for (option of group.albums; track option.id) {
                        <option [value]="value(group.account.id, option.id)">{{ label(option) }}</option>
                      }
                    }
                  }
                </select>
              </div>
              <div class="hd-field">
                <label class="hd-field__label" for="new-set">Name</label>
                <input #newName id="new-set" class="hd-input" [placeholder]="namePlaceholder()" (keydown.escape)="adding.set(false)" />
              </div>
              <div class="actions">
                <button class="hd-btn hd-btn--primary" type="submit" [disabled]="!chosenAlbum() || busy()">Add photo set</button>
                <button class="hd-btn" type="button" (click)="adding.set(false)">Cancel</button>
              </div>
            </form>
          } @else {
            <form class="rules" (submit)="createSelection($event, ruleName.value)">
              <div class="hd-field">
                <label class="hd-field__label" for="new-rules-set">Name</label>
                <input #ruleName id="new-rules-set" class="hd-input" placeholder="Such as Family or Landscapes" (keydown.escape)="adding.set(false)" />
              </div>
              @if (accounts().length > 1) {
                <div class="hd-field">
                  <label class="hd-field__label" for="new-rules-account">Immich account</label>
                  <select id="new-rules-account" class="hd-select" (change)="ruleAccount.set(+$any($event.target).value)">
                    @for (account of accounts(); track account.id) {
                      <option [value]="account.id" [selected]="account.id === ruleAccount()">{{ account.name }}</option>
                    }
                  </select>
                </div>
              }
              <hd-photo-selection-form [(selection)]="newSelection" [accountId]="ruleAccount()" />
              <div class="actions start">
                <button class="hd-btn hd-btn--primary" type="submit" [disabled]="busy()">{{ busy() ? 'Drawing photos…' : 'Add photo set' }}</button>
                <button class="hd-btn" type="button" (click)="adding.set(false)">Cancel</button>
              </div>
            </form>
          }
        </div>
      }
      @if (data.photoSetsLoaded() && sets().length === 0 && !adding()) {
        <div class="empty hd-panel">
          <h2>No photo sets yet</h2>
          <p>
            A photo set follows an album in Immich, or draws photos at random from Immich by rules, such as who is in them
            and what they show. Photo tiles show its photos.
          </p>
        </div>
      }
      @for (set of sets(); track set.id) {
        <section class="set hd-panel" [attr.aria-label]="set.name">
          <div class="previews" aria-hidden="true">
            @for (photo of set.photos.slice(0, 4); track photo.id) {
              <img [src]="url(set, photo)" alt="" loading="lazy" />
            }
          </div>
          <div class="info">
            <input
              class="hd-input name"
              [attr.aria-label]="'Name of ' + set.name"
              [value]="set.name"
              (change)="rename(set, name.value)"
              (keydown.enter)="name.blur()"
              #name
            />
            @if (changingAlbum() === set.id) {
              <select
                #other
                class="hd-select"
                [attr.aria-label]="'Album of ' + set.name"
                (change)="changeAlbum(set, other.value)"
                (keydown.escape)="changingAlbum.set(null)"
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
            @if (editing() === set.id) {
              <form class="rules" (submit)="saveSelection($event, set)">
                @if (accounts().length > 1 || set.accountId === null) {
                  <div class="hd-field">
                    <label class="hd-field__label" [for]="'rules-account-' + set.id">Immich account</label>
                    <select [id]="'rules-account-' + set.id" class="hd-select" (change)="editedAccount.set(+$any($event.target).value || null)">
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
                <div class="actions start">
                  <button class="hd-btn hd-btn--primary" type="submit">Save and draw</button>
                  <button class="hd-btn" type="button" (click)="editing.set(null)">Cancel</button>
                </div>
              </form>
            }
            @if (set.selection; as selection) {
              <p class="muted">{{ summary(selection) }}</p>
            }
            <p class="muted">
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
            <p class="muted">
              @if (set.dashboards.length) {
                Shown on {{ set.dashboards.join(', ') }}
              } @else {
                Not on any dashboard
              }
            </p>
            @if (set.syncError; as syncError) {
              <p class="status failed" role="status">{{ syncError }}</p>
            }
          </div>
          <div class="actions">
            @if (removing() === set.id) {
              <span class="muted">{{ set.dashboards.length ? 'Its tiles show as missing.' : 'The album stays in Immich.' }}</span>
              <button class="hd-btn hd-btn--danger" type="button" (click)="remove(set)">Delete</button>
              <button class="hd-btn" type="button" (click)="removing.set(null)">Cancel</button>
            } @else {
              <button class="hd-btn hd-btn--primary" type="button" [disabled]="syncing() === set.id" (click)="sync(set)">
                @if (set.selection) {
                  {{ syncing() === set.id ? 'Drawing…' : 'Draw again' }}
                } @else {
                  {{ syncing() === set.id ? 'Syncing…' : 'Sync now' }}
                }
              </button>
              @if (set.selection) {
                @if (editing() !== set.id) {
                  <button class="hd-btn" type="button" (click)="startEditing(set)">Edit rules</button>
                }
              } @else if (changingAlbum() === set.id) {
                <button class="hd-btn" type="button" (click)="changingAlbum.set(null)">Keep album</button>
              } @else {
                <button class="hd-btn" type="button" (click)="startChangingAlbum(set)">Change album</button>
              }
              <button class="hd-btn hd-btn--danger" type="button" (click)="removing.set(set.id)">Delete photo set</button>
            }
          </div>
        </section>
      }
      @if (error(); as error) {
        <p class="error" role="alert">
          {{ error }}
          @if (error.includes('Accounts')) {
            <a routerLink="/accounts">Go to Accounts</a>
          }
        </p>
      }
    </div>
  `,
  styles: `
    .header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-4) var(--space-6); border-bottom: 1px solid var(--line); }
    h1 { font-size: 22px; font-weight: 800; margin: 0; }
    h2 { font-size: 18px; font-weight: 800; margin: 0 0 var(--space-2); }
    .body { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); max-width: 900px; }
    .empty { padding: var(--space-6); }
    .empty p { margin: 0; color: var(--ink-muted); }
    .set { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-4); padding: var(--space-4); }
    .new-panel { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-4); }
    .source { display: flex; gap: var(--space-2); }
    .new { display: grid; grid-template-columns: 1fr 1fr auto; align-items: end; gap: var(--space-4); }
    .rules { display: flex; flex-direction: column; gap: var(--space-4); max-width: 560px; }
    .actions.start { justify-content: flex-start; }
    .previews { display: grid; grid-template-columns: repeat(2, 40px); grid-auto-rows: 40px; gap: 4px; width: 84px; min-height: 84px; border-radius: 10px; background: var(--tile-surface); overflow: hidden; }
    .previews img { width: 100%; height: 100%; object-fit: cover; }
    .info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .name { font-weight: 700; }
    .muted { color: var(--ink-muted); margin: 0; }
    .status { margin: 0; font-weight: 700; }
    .status.failed, .error { color: var(--danger); }
    .error { margin: 0; font-weight: 700; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-2); }
    @media (max-width: 860px) {
      .set, .new { grid-template-columns: 1fr; }
      .set:has(.rules) { grid-template-columns: 1fr; }
      .actions { justify-content: flex-start; }
    }
  `,
})
export class PhotoSetsPage {
  protected readonly data = inject(RealtimeTileData);
  private readonly api = inject(PhotoSetsApi);

  protected readonly sets = computed(() => [...this.data.photoSets().values()].sort((a, b) => a.name.localeCompare(b.name)));
  private readonly accountsApi = inject(ImmichAccountApi);

  protected readonly accounts = signal<ImmichAccount[]>([]);
  /** Every Immich account's albums, once asked for. */
  protected readonly groups = signal<AlbumGroup[] | null>(null);
  protected readonly adding = signal(false);
  protected readonly ruleAccount = signal<number | null>(null);
  protected readonly editedAccount = signal<number | null>(null);
  protected readonly source = signal<'album' | 'rules'>('album');
  protected readonly newSelection = signal<PhotoSelection>(defaultSelection());
  protected readonly editing = signal<string | null>(null);
  protected readonly editedSelection = signal<PhotoSelection>(defaultSelection());
  protected readonly chosenAlbum = signal('');
  protected readonly namePlaceholder = computed(() => {
    const chosen = parseAlbumValue(this.chosenAlbum());
    const group = this.groups()?.find((g) => g.account.id === chosen?.accountId);
    return group?.albums.find((a) => a.id === chosen?.albumId)?.name ?? 'The album’s name, unless you give another';
  });
  protected readonly changingAlbum = signal<string | null>(null);
  protected readonly syncing = signal<string | null>(null);
  protected readonly removing = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly albumSelect = viewChild<ElementRef<HTMLSelectElement>>('album');

  // Ticks so "synced … ago" stays true while the page is open.
  private readonly now = signal(Date.now());

  constructor() {
    this.loadAccounts();
    const ticker = setInterval(() => this.now.set(Date.now()), 30_000);
    effect((onCleanup) => onCleanup(() => clearInterval(ticker)));
    effect(() => {
      if (this.adding()) this.albumSelect()?.nativeElement.focus();
    });
  }

  protected url(set: PhotoSet, photo: PhotoSet['photos'][number]) {
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

  protected startAdding() {
    this.chosenAlbum.set('');
    this.source.set('album');
    this.adding.set(true);
    this.loadAccounts();
    this.loadAlbums();
  }

  protected startRules() {
    this.newSelection.set(defaultSelection());
    this.ruleAccount.set(this.accounts()[0]?.id ?? null);
    this.source.set('rules');
  }

  protected startEditing(set: PhotoSet) {
    if (!set.selection) return;
    this.editedSelection.set(set.selection);
    this.editedAccount.set(set.accountId);
    this.editing.set(set.id);
  }

  protected async createSelection(event: Event, name: string) {
    event.preventDefault();
    if (!name.trim()) {
      this.error.set('Give the photo set a name.');
      return;
    }
    const accountId = this.ruleAccount();
    if (accountId === null) {
      this.error.set('Set up Immich under Accounts first.');
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.createSelection(accountId, name.trim(), this.newSelection()));
      this.adding.set(false);
      this.error.set(null);
    } catch (e) {
      this.error.set(problem(e, 'Could not add the photo set. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected saveSelection(event: Event, set: PhotoSet) {
    event.preventDefault();
    const accountId = this.editedAccount();
    if (accountId === null) {
      this.error.set('Choose an Immich account for the photo set.');
      return;
    }
    this.api.update(set.id, { selection: this.editedSelection(), accountId }).subscribe({
      next: () => {
        this.editing.set(null);
        this.error.set(null);
      },
      error: (e) => this.error.set(problem(e, 'Could not save the rules. Try again.')),
    });
  }

  protected startChangingAlbum(set: PhotoSet) {
    this.changingAlbum.set(set.id);
    this.loadAlbums();
  }

  protected async create(event: Event, value: string, name: string) {
    event.preventDefault();
    const album = parseAlbumValue(value);
    if (!album) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.create(album.accountId, album.albumId, name.trim()));
      this.adding.set(false);
      this.error.set(null);
    } catch (e) {
      this.error.set(problem(e, 'Could not add the photo set. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async sync(set: PhotoSet) {
    this.syncing.set(set.id);
    try {
      // A sync that fails says why on the set itself.
      await firstValueFrom(this.api.sync(set.id));
      this.error.set(null);
    } catch (e) {
      this.error.set(problem(e, 'Could not sync the photo set. Try again.'));
    } finally {
      this.syncing.set(null);
    }
  }

  // An album of another account moves the set to that account.
  protected changeAlbum(set: PhotoSet, value: string) {
    const album = parseAlbumValue(value);
    if (!album || this.isAlbumOf(set, album.accountId, album.albumId)) return;
    this.changingAlbum.set(null);
    this.api.update(set.id, album).subscribe({ error: (e) => this.error.set(problem(e, 'Could not change the album. Try again.')) });
  }

  protected rename(set: PhotoSet, name: string) {
    if (!name.trim() || name.trim() === set.name) return;
    this.api.update(set.id, { name: name.trim() }).subscribe({ error: () => this.error.set('Could not rename the photo set. Try again.') });
  }

  protected remove(set: PhotoSet) {
    this.api.delete(set.id).subscribe({
      next: () => this.removing.set(null),
      error: () => this.error.set('Could not delete the photo set. Try again.'),
    });
  }

  private async loadAlbums() {
    const { groups, error } = await loadAlbums(this.accountsApi, this.api);
    this.error.set(error);
    this.groups.set(groups);
  }

  private loadAccounts() {
    this.accountsApi.list().subscribe({
      next: ({ accounts }) => {
        this.accounts.set(accounts);
        if (this.ruleAccount() === null) this.ruleAccount.set(accounts[0]?.id ?? null);
      },
      error: (e) => this.error.set(problem(e, 'Could not load the Immich accounts. Try again.')),
    });
  }
}
