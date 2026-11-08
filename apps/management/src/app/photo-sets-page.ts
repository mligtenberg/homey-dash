import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { apiProblem, ImmichAccount, ImmichAccountApi, ImmichAlbum, PhotoSelection, PhotoSet, PhotoSetsApi, photoUrl } from '@homey-dash/api-client';
import { RealtimeTileData } from '@homey-dash/tiles';
import { firstValueFrom } from 'rxjs';
import { AlbumGroup, albumLabel, albumValue, loadAlbums, parseAlbumValue } from './immich-albums';
import { defaultSelection, PhotoSelectionForm } from './photo-selection-form';

/**
 * An overview of every photo set (ADR-0008), kept current over the realtime connection: a few of its photos, where they
 * come from, the dashboards that show it and whether its last sync failed. Each opens its own page with the rest
 * (PhotoSetPage). New photo sets are made here, from an album or by rules; with several Immich accounts, albums are
 * grouped by account.
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
                <button class="hd-btn hd-btn--primary" type="submit" [disabled]="busy()">{{ busy() ? 'Adding…' : 'Add photo set' }}</button>
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
      @if (sets().length) {
        <ul class="sets">
          @for (set of sets(); track set.id) {
            <li>
              <a class="set hd-panel" [routerLink]="['/photo-sets', set.id]">
                <div class="previews" aria-hidden="true">
                  @for (photo of set.photos.slice(0, 4); track photo.id) {
                    <img [src]="url(set, photo)" alt="" loading="lazy" />
                  }
                </div>
                <div class="info">
                  <span class="name">{{ set.name }}</span>
                  <span class="muted">
                    {{ set.photos.length }} {{ set.photos.length === 1 ? 'photo' : 'photos' }}
                    @if (set.selection) {
                      at random, by rules
                    } @else if (set.albumName) {
                      from {{ set.albumName }}
                    }
                    @if (set.excluded.length) {
                      · {{ set.excluded.length }} excluded
                    }
                  </span>
                  <span class="muted">
                    @if (set.dashboards.length) {
                      Shown on {{ set.dashboards.join(', ') }}
                    } @else {
                      Not on any dashboard
                    }
                  </span>
                  @if (set.syncing) {
                    <span class="status">{{ set.selection ? 'Drawing photos…' : 'Syncing…' }}</span>
                  } @else if (set.syncError) {
                    <span class="status failed">{{ set.selection ? 'Drawing' : 'Syncing' }} failed</span>
                  }
                </div>
                <span class="chevron" aria-hidden="true">›</span>
              </a>
            </li>
          }
        </ul>
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
    .sets { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
    .set { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-4); padding: var(--space-4); color: inherit; text-decoration: none; }
    .set:hover { border-color: var(--brand); }
    .chevron { font-size: 28px; color: var(--ink-muted); }
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
      .new { grid-template-columns: 1fr; }
      .actions { justify-content: flex-start; }
    }
  `,
})
export class PhotoSetsPage {
  protected readonly data = inject(RealtimeTileData);
  private readonly api = inject(PhotoSetsApi);
  private readonly router = inject(Router);

  protected readonly sets = computed(() => [...this.data.photoSets().values()].sort((a, b) => a.name.localeCompare(b.name)));
  private readonly accountsApi = inject(ImmichAccountApi);

  protected readonly accounts = signal<ImmichAccount[]>([]);
  /** Every Immich account's albums, once asked for. */
  protected readonly groups = signal<AlbumGroup[] | null>(null);
  protected readonly adding = signal(false);
  protected readonly ruleAccount = signal<number | null>(null);
  protected readonly source = signal<'album' | 'rules'>('album');
  protected readonly newSelection = signal<PhotoSelection>(defaultSelection());
  protected readonly chosenAlbum = signal('');
  protected readonly namePlaceholder = computed(() => {
    const chosen = parseAlbumValue(this.chosenAlbum());
    const group = this.groups()?.find((g) => g.account.id === chosen?.accountId);
    return group?.albums.find((a) => a.id === chosen?.albumId)?.name ?? 'The album’s name, unless you give another';
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly albumSelect = viewChild<ElementRef<HTMLSelectElement>>('album');

  constructor() {
    this.loadAccounts();
    effect(() => {
      if (this.adding()) this.albumSelect()?.nativeElement.focus();
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
      const set = await firstValueFrom(this.api.createSelection(accountId, name.trim(), this.newSelection()));
      this.adding.set(false);
      this.router.navigate(['/photo-sets', set.id]);
      this.error.set(null);
    } catch (e) {
      this.error.set(apiProblem(e, 'Could not add the photo set. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async create(event: Event, value: string, name: string) {
    event.preventDefault();
    const album = parseAlbumValue(value);
    if (!album) return;
    this.busy.set(true);
    try {
      const set = await firstValueFrom(this.api.create(album.accountId, album.albumId, name.trim()));
      this.adding.set(false);
      this.router.navigate(['/photo-sets', set.id]);
      this.error.set(null);
    } catch (e) {
      this.error.set(apiProblem(e, 'Could not add the photo set. Try again.'));
    } finally {
      this.busy.set(false);
    }
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
      error: (e) => this.error.set(apiProblem(e, 'Could not load the Immich accounts. Try again.')),
    });
  }
}
