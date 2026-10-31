import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { SignalInfo } from '@homey-dash/api-client';
import { TileData } from '@homey-dash/tiles';
import { LucideChevronLeft, LucideDynamicIcon } from '@lucide/angular';
import { groupKey, SignalCatalogue } from './signal-catalogue';
import { buildPlaces, countSignals, findPlace, PickerGroup, placeGroups, placeOf, searchSignals, SignalPlace } from './signal-tree';

/**
 * Picks a condition's signal: looks like a select, and opens a dialog with the accounts, Homey's zones and HomeyDash's
 * own signals on the left; on the right the groups in the picked one, such as its devices, and once a group is open
 * its signals. The search looks through every signal.
 */
@Component({
  selector: 'hd-signal-picker',
  imports: [NgTemplateOutlet, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="hd-select trigger" aria-label="Signal" [class.placeholder]="!current()" (click)="open()">
      {{ summary() }}
    </button>

    <dialog #dialog class="hd-panel" aria-label="Pick a signal" closedby="any" (close)="query.set('')">
      <div class="head">
        <input
          #search
          class="hd-input"
          type="search"
          placeholder="Search signals"
          aria-label="Search signals"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
          (keydown.enter)="$event.preventDefault(); pickFirst()"
        />
        <button type="button" class="hd-btn" (click)="dialog.close()">Cancel</button>
      </div>

      <div class="body">
        <nav aria-label="Accounts and rooms">
          <ng-container [ngTemplateOutlet]="placeList" [ngTemplateOutletContext]="{ $implicit: places(), top: true }" />
        </nav>

        <div class="list">
          @if (query()) {
            @for (found of matches(); track found.signal.id) {
              <ng-container
                [ngTemplateOutlet]="signalRow"
                [ngTemplateOutletContext]="{ $implicit: found.signal, group: found.group, detail: found.group.label + ' · ' + found.place.name }"
              />
            } @empty {
              <p class="empty">No signals match "{{ query() }}"</p>
            }
          } @else if (group(); as group) {
            @if (groups().length > 1) {
              <button type="button" class="back" (click)="openGroup.set(null)">
                <svg class="hd-icon" [lucideIcon]="back" />
                <span>{{ group.label }}</span>
              </button>
            }
            @for (s of group.signals; track s.id) {
              <ng-container [ngTemplateOutlet]="signalRow" [ngTemplateOutletContext]="{ $implicit: s, group, detail: describe(s) }" />
            }
          } @else {
            @for (entry of groups(); track entry.group.key) {
              <button
                type="button"
                class="row"
                [attr.aria-current]="entry.group.key === currentGroup()"
                [style.--k-ink]="'var(--kind-' + entry.group.hue + '-ink)'"
                [style.--k-fill]="'var(--kind-' + entry.group.hue + '-fill)'"
                (click)="openGroup.set(entry.group.key)"
              >
                <span class="icon"><svg class="hd-icon" [lucideIcon]="entry.group.icon" /></span>
                <span class="text">
                  <span class="name">{{ entry.group.label }}</span>
                  <span class="type">{{ entry.group.type }}@if (entry.place !== place()) { · {{ entry.place.name }} }</span>
                </span>
                <span class="count">{{ entry.group.signals.length }}</span>
              </button>
            } @empty {
              <p class="empty">{{ catalogue.signals() ? 'There are no signals here' : 'Loading signals…' }}</p>
            }
          }
        </div>
      </div>
    </dialog>

    <ng-template #placeList let-list let-top="top">
      @for (p of list; track p.id) {
        <button type="button" class="place" [class.top]="top" [attr.aria-current]="p.id === place()?.id" (click)="pickPlace(p.id)">
          <span>{{ p.name }}</span><span class="count">{{ count(p) }}</span>
        </button>
        @if (p.places.length) {
          <div class="nested">
            <ng-container [ngTemplateOutlet]="placeList" [ngTemplateOutletContext]="{ $implicit: p.places, top: false }" />
          </div>
        }
      }
    </ng-template>

    <ng-template #signalRow let-s let-group="group" let-detail="detail">
      <button
        type="button"
        class="row"
        [attr.aria-current]="s.id === value()"
        [style.--k-ink]="'var(--kind-' + group.hue + '-ink)'"
        [style.--k-fill]="'var(--kind-' + group.hue + '-fill)'"
        (click)="pick(s.id)"
      >
        <span class="icon"><svg class="hd-icon" [lucideIcon]="group.icon" /></span>
        <span class="text">
          <span class="name">{{ s.name }}</span>
          <span class="type">{{ detail }}</span>
        </span>
      </button>
    </ng-template>
  `,
  styles: `
    :host { display: contents; }
    .trigger {
      position: relative; padding-right: 36px; text-align: left; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .trigger::after {
      content: "•••"; position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
      font-size: 9px; letter-spacing: 1px; color: var(--ink-muted);
    }
    .trigger.placeholder { color: var(--ink-muted); }
    dialog {
      width: min(760px, calc(100vw - 32px)); height: min(560px, calc(100vh - 64px));
      padding: 0; color: var(--ink); flex-direction: column;
    }
    dialog[open] { display: flex; }
    dialog::backdrop { background: color-mix(in oklab, black 40%, transparent); }
    .head { display: flex; gap: var(--space-2); padding: var(--space-4); border-bottom: 1px solid var(--line); }
    .head input { flex: 1; min-width: 0; }
    .body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(150px, 34%) 1fr; }
    nav, .list { overflow-y: auto; padding: var(--space-3); }
    nav { border-right: 1px solid var(--line); background: var(--chrome); }
    .nested { padding-left: var(--space-3); }
    .place.top:not(:first-child) { margin-top: var(--space-3); }
    button.place, button.row, button.back {
      display: flex; align-items: center; gap: var(--space-3); width: 100%; text-align: left;
      font: 600 14px/1.3 var(--font-sans); color: var(--ink);
      padding: 8px 10px; border: 0; border-radius: var(--radius-control); background: none; cursor: pointer;
    }
    .place.top { font-weight: 700; }
    .place > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { font-size: 12px; color: var(--ink-muted); }
    .row .count { margin-left: auto; }
    .back { --icon-size: .9; color: var(--ink-muted); margin-bottom: var(--space-1); }
    :is(.place, .row, .back):hover, :is(.place, .row, .back):focus-visible {
      background: color-mix(in oklab, var(--brand) 10%, transparent); outline: none;
    }
    .place[aria-current='true'] { background: color-mix(in oklab, var(--brand) 16%, transparent); color: var(--brand); }
    .icon {
      --cell: 34px; --icon-size: .6;
      display: grid; place-items: center; width: 34px; height: 34px; flex: none;
      border-radius: 10px; background: color-mix(in oklab, var(--k-fill) 45%, transparent);
    }
    .text { display: flex; flex-direction: column; min-width: 0; }
    .name, .type { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .type { font: 500 12px/1.3 var(--font-sans); color: var(--ink-muted); }
    .row[aria-current='true'] { box-shadow: inset 0 0 0 2px var(--brand); }
    .empty { color: var(--ink-muted); margin: var(--space-2); }
    @media (max-width: 560px) { .body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; } nav { max-height: 30vh; border-right: 0; border-bottom: 1px solid var(--line); } }
  `,
})
export class SignalPicker {
  /** The signal's id; one HomeyDash doesn't have any more shows as missing. */
  readonly value = input.required<string>();
  readonly picked = output<string>();

  protected readonly catalogue = inject(SignalCatalogue);
  private readonly data = inject(TileData);
  protected readonly back = LucideChevronLeft;

  protected readonly query = signal('');
  /** The place picked on the left; the first when none is. */
  private readonly selected = signal<string | null>(null);
  /** The group open on the right; its place's groups when none is. */
  protected readonly openGroup = signal<string | null>(null);

  protected readonly places = computed(() => buildPlaces(this.catalogue.groups(), this.data.homeys() ?? []));
  protected readonly place = computed(() => findPlace(this.places(), this.selected()) ?? this.places()[0]);
  protected readonly groups = computed(() => {
    const place = this.place();
    return place ? placeGroups(place) : [];
  });
  // A place with a single group, such as a Plex account, opens it straight away.
  protected readonly group = computed<PickerGroup | undefined>(() => {
    const groups = this.groups();
    return groups.length === 1 ? groups[0].group : groups.find((g) => g.group.key === this.openGroup())?.group;
  });
  protected readonly matches = computed(() => searchSignals(this.places(), this.query()));

  protected readonly current = computed(() => this.catalogue.byId().get(this.value()));
  protected readonly currentGroup = computed(() => {
    const current = this.current();
    return current ? groupKey(current) : null;
  });
  protected readonly summary = computed(() => {
    const current = this.current();
    if (!current) return 'Missing signal';
    return current.group === current.name ? current.name : `${current.group} — ${current.name}`;
  });

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');

  protected count(place: SignalPlace) {
    return countSignals(place);
  }

  protected describe(s: SignalInfo) {
    const kind = { yesNo: 'Yes or no', number: 'Number', text: 'Text', dateTime: 'Date and time' }[s.type as string] ?? s.type;
    return s.unit ? `${kind} · ${s.unit}` : kind;
  }

  // Opens on the current signal's group, in its place.
  protected open() {
    const key = this.currentGroup();
    this.selected.set(key ? (placeOf(this.places(), key)?.id ?? null) : null);
    this.openGroup.set(key);
    const dialog = this.dialog().nativeElement;
    dialog.showModal();
    this.search().nativeElement.focus();
    setTimeout(() => {
      dialog.querySelector('.place[aria-current="true"]')?.scrollIntoView({ block: 'center' });
      dialog.querySelector('.row[aria-current="true"]')?.scrollIntoView({ block: 'center' });
    });
  }

  protected pickPlace(id: string) {
    this.query.set('');
    this.selected.set(id);
    this.openGroup.set(null);
  }

  protected pick(id: string) {
    this.dialog().nativeElement.close();
    if (id !== this.value()) this.picked.emit(id);
  }

  protected pickFirst() {
    const first = this.query() ? this.matches()[0]?.signal : this.group()?.signals[0];
    if (first) this.pick(first.id);
  }
}
