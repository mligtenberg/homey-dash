import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal } from '@angular/core';
import { apiProblem, PersonRef, PhotoSelection, PhotoSetsApi, SELECTION_MAX_COUNT, SELECTION_REFRESH } from '@homey-dash/api-client';
import { firstValueFrom } from 'rxjs';

/** A new selection's rules: anyone, anything, 100 photos, drawn again every day. */
export function defaultSelection(): PhotoSelection {
  return { with: [], without: [], query: null, count: 100, refreshHours: 24 };
}

/** A selection's rules in a few words: "Anna or Bram, not Cas · landscape · 100 photos, every day". */
export function selectionSummary(selection: PhotoSelection) {
  const people = selection.with.length ? selection.with.map((p) => p.name).join(' or ') : 'Anyone';
  const not = selection.without.length ? `, not ${selection.without.map((p) => p.name).join(' or ')}` : '';
  const query = selection.query ? ` · ${selection.query}` : '';
  const label = SELECTION_REFRESH.find((r) => r.hours === selection.refreshHours)?.label ?? '';
  const refresh = label.charAt(0).toLowerCase() + label.slice(1);
  return `${people}${not}${query} · ${selection.count} photos, ${refresh}`;
}

/**
 * The rules a photo set draws its photos from Immich by: people who should be in them (at least one), people who
 * should not, what should be in them, how many and how often to draw again, from the people of the Immich account
 * `accountId`. Edits `selection` in place.
 */
@Component({
  selector: 'hd-photo-selection-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <span class="hd-field__label" id="with-label">With</span>
      <div class="chips" role="list" aria-labelledby="with-label">
        @for (person of selection().with; track person.id) {
          <span class="chip" role="listitem">
            {{ person.name }}
            <button type="button" class="chip__remove" [attr.aria-label]="'Remove ' + person.name" (click)="remove(person)">×</button>
          </span>
        } @empty {
          <span class="hint">Anyone. Add people to only show photos with at least one of them.</span>
        }
      </div>
    </div>
    <div class="hd-field">
      <span class="hd-field__label" id="without-label">Never with</span>
      <div class="chips" role="list" aria-labelledby="without-label">
        @for (person of selection().without; track person.id) {
          <span class="chip chip--out" role="listitem">
            {{ person.name }}
            <button type="button" class="chip__remove" [attr.aria-label]="'Remove ' + person.name" (click)="remove(person)">×</button>
          </span>
        } @empty {
          <span class="hint">Nobody left out.</span>
        }
      </div>
    </div>
    <div class="hd-field">
      <label class="hd-field__label" for="person-search">Find someone</label>
      <input
        id="person-search"
        class="hd-input"
        autocomplete="off"
        [placeholder]="accountId() === null ? 'Choose an Immich account first' : people() ? 'Name, as in Immich' : 'Loading people…'"
        [value]="search()"
        (input)="search.set($any($event.target).value)"
        (focus)="loadPeople()"
      />
      @if (matches().length) {
        <ul class="matches">
          @for (person of matches(); track person.id) {
            <li>
              <span>{{ person.name }}</span>
              <button class="hd-btn" type="button" (click)="add(person, 'with')">With</button>
              <button class="hd-btn" type="button" (click)="add(person, 'without')">Never with</button>
            </li>
          }
        </ul>
      } @else if (search() && people()) {
        <span class="hint">Nobody by that name. Name people in Immich to find them here.</span>
      }
    </div>
    <div class="hd-field">
      <label class="hd-field__label" for="selection-query">What's in them</label>
      <input
        id="selection-query"
        class="hd-input"
        autocomplete="off"
        placeholder="Such as landscape, beach or snow"
        [value]="selection().query ?? ''"
        (change)="set({ query: $any($event.target).value.trim() || null })"
      />
      <span class="hint">Immich's smart search finds photos by what they show. Leave it empty for anything.</span>
    </div>
    <div class="row">
      <div class="hd-field">
        <label class="hd-field__label" for="selection-count">Photos</label>
        <input
          id="selection-count"
          class="hd-input"
          type="number"
          min="1"
          [max]="maxCount"
          [value]="selection().count"
          (change)="setCount($any($event.target).value)"
        />
      </div>
      <div class="hd-field">
        <label class="hd-field__label" for="selection-refresh">Draw new photos</label>
        <select id="selection-refresh" class="hd-select" (change)="set({ refreshHours: +$any($event.target).value })">
          @for (option of refreshOptions; track option.hours) {
            <option [value]="option.hours" [selected]="option.hours === selection().refreshHours">{{ option.label }}</option>
          }
        </select>
      </div>
    </div>
    @if (error(); as error) {
      <span class="error" role="alert">{{ error }}</span>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-4); }
    .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); min-height: 32px; align-items: center; }
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 4px 4px 12px; border-radius: 999px; background: var(--tile-surface); font-weight: 700; }
    .chip--out { text-decoration: line-through; color: var(--ink-muted); }
    .chip__remove { border: 0; background: none; color: inherit; font-size: 18px; line-height: 1; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; }
    .chip__remove:hover { background: var(--line); }
    .matches { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .matches li { display: flex; align-items: center; gap: var(--space-2); }
    .matches span { flex: 1; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
    .hint { font-size: 13px; color: var(--ink-muted); }
    .error { font-size: 13px; color: var(--danger); font-weight: 700; }
  `,
})
export class PhotoSelectionForm {
  readonly selection = model.required<PhotoSelection>();
  readonly accountId = input.required<number | null>();

  private readonly api = inject(PhotoSetsApi);

  protected readonly maxCount = SELECTION_MAX_COUNT;
  protected readonly refreshOptions = SELECTION_REFRESH;
  protected readonly people = signal<PersonRef[] | null>(null);
  protected readonly search = signal('');
  protected readonly error = signal<string | null>(null);

  /** Up to 8 people whose name has the search in it, leaving out those already chosen. */
  protected readonly matches = computed(() => {
    const search = this.search().trim().toLocaleLowerCase();
    const chosen = new Set([...this.selection().with, ...this.selection().without].map((p) => p.id));
    if (!search) return [];
    return (this.people() ?? []).filter((p) => !chosen.has(p.id) && p.name.toLocaleLowerCase().includes(search)).slice(0, 8);
  });

  private loading = false;

  constructor() {
    // Another account knows other people.
    effect(() => {
      this.accountId();
      this.people.set(null);
    });
  }

  protected async loadPeople() {
    const accountId = this.accountId();
    if (this.people() || this.loading || accountId === null) return;
    this.loading = true;
    try {
      const people = await firstValueFrom(this.api.people(accountId));
      if (accountId === this.accountId()) this.people.set(people);
      this.error.set(null);
    } catch (e) {
      this.error.set(apiProblem(e, 'Could not load the people from Immich. Try again.'));
    } finally {
      this.loading = false;
    }
  }

  protected add(person: PersonRef, list: 'with' | 'without') {
    this.set({ [list]: [...this.selection()[list], person] });
    this.search.set('');
  }

  protected remove(person: PersonRef) {
    const { with: withPeople, without } = this.selection();
    this.set({ with: withPeople.filter((p) => p.id !== person.id), without: without.filter((p) => p.id !== person.id) });
  }

  protected setCount(value: string) {
    const count = Math.round(Number(value));
    this.set({ count: Number.isFinite(count) ? Math.min(Math.max(count, 1), SELECTION_MAX_COUNT) : 100 });
  }

  protected set(change: Partial<PhotoSelection>) {
    this.selection.update((selection) => ({ ...selection, ...change }));
  }
}
