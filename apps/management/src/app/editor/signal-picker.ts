import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { SignalInfo } from '@homey-dash/api-client';
import { TileData } from '@homey-dash/tiles';
import { LucideChevronLeft } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { PickerDialog, PickerRow } from './picker-dialog';
import { groupKey, SignalCatalogue } from './signal-catalogue';
import { buildPlaces, countSignals, findPlace, PickerGroup, placeGroups, placeOf, searchSignals, SignalPlace } from './signal-tree';
import { TranslatePipe } from '@homey-dash/i18n';

/**
 * Picks a condition's signal: looks like a select, and opens a dialog with the accounts, Homey's zones and HomeyDash's
 * own signals on the left; on the right the groups in the picked one, such as its devices, and once a group is open
 * its signals. The search looks through every signal.
 */
@Component({
  selector: 'hd-signal-picker',
  imports: [NgTemplateOutlet, LucideDynamicIcon, PickerDialog, PickerRow, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-picker-dialog
      #picker
      triggerLabel="Signal"
      [label]="'Pick a signal' | t"
      searchLabel="Search signals"
      navLabel="Accounts and rooms"
      [summary]="summary()"
      [placeholder]="!current()"
      [(query)]="query"
      (opening)="open()"
      (enter)="pickFirst()"
    >
      <ng-container ngProjectAs="[pickerNav]" [ngTemplateOutlet]="placeList" [ngTemplateOutletContext]="{ $implicit: places(), top: true }" />

      @if (query()) {
        @for (found of matches(); track found.signal.id) {
          <ng-container
            [ngTemplateOutlet]="signalRow"
            [ngTemplateOutletContext]="{ $implicit: found.signal, group: found.group, detail: found.group.label + ' · ' + found.place.name }"
          />
        } @empty {
          <p class="hd-picker__empty">No signals match "{{ query() }}"</p>
        }
      } @else if (group(); as group) {
        @if (groups().length > 1) {
          <button type="button" class="hd-picker__back" (click)="openGroup.set(null)">
            <svg class="hd-icon" [lucideIcon]="back" />
            <span>{{ group.label }}</span>
          </button>
        }
        @for (s of group.signals; track s.id) {
          <ng-container [ngTemplateOutlet]="signalRow" [ngTemplateOutletContext]="{ $implicit: s, group, detail: describe(s) }" />
        }
      } @else {
        @for (entry of groups(); track entry.group.key) {
          <hd-picker-row
            [icon]="entry.group.icon"
            [hue]="entry.group.hue"
            [name]="entry.group.label"
            [detail]="entry.group.type + (entry.place !== place() ? ' · ' + entry.place.name : '')"
            [count]="entry.group.signals.length"
            [current]="entry.group.key === currentGroup()"
            (pressed)="openGroup.set(entry.group.key)"
          />
        } @empty {
          <p class="hd-picker__empty">{{ (catalogue.signals() ? 'There are no signals here' : 'Loading signals…') | t }}</p>
        }
      }
    </hd-picker-dialog>

    <ng-template #placeList let-list let-top="top">
      @for (p of list; track p.id) {
        <button type="button" class="hd-picker__group" [class.is-top]="top" [attr.aria-current]="p.id === place()?.id" (click)="pickPlace(p.id)">
          <span>{{ p.name }}</span><span class="hd-picker__count">{{ count(p) }}</span>
        </button>
        @if (p.places.length) {
          <div class="hd-picker__nested">
            <ng-container [ngTemplateOutlet]="placeList" [ngTemplateOutletContext]="{ $implicit: p.places, top: false }" />
          </div>
        }
      }
    </ng-template>

    <ng-template #signalRow let-s let-group="group" let-detail="detail">
      <hd-picker-row
        [icon]="group.icon"
        [hue]="group.hue"
        [name]="s.name"
        [detail]="detail"
        [current]="s.id === value()"
        (pressed)="pick(s.id)"
      />
    </ng-template>
  `,
})
export class SignalPicker {
  /** The signal's id; one HomeyDash doesn't have any more shows as missing. */
  readonly value = input.required<string>();
  readonly picked = output<string>();
  /** Which signals it offers; every one without it. */
  readonly only = input<(signal: SignalInfo) => boolean>();

  protected readonly catalogue = inject(SignalCatalogue);
  private readonly data = inject(TileData);
  protected readonly back = LucideChevronLeft;

  protected readonly query = signal('');
  /** The place picked on the left; the first when none is. */
  private readonly selected = signal<string | null>(null);
  /** The group open on the right; its place's groups when none is. */
  protected readonly openGroup = signal<string | null>(null);

  protected readonly places = computed(() => {
    const only = this.only();
    const groups = only
      ? this.catalogue.groups().map((g) => ({ ...g, signals: g.signals.filter(only) })).filter((g) => g.signals.length)
      : this.catalogue.groups();
    return buildPlaces(groups, this.data.homeys() ?? []);
  });
  protected readonly place = computed<SignalPlace | undefined>(() => findPlace(this.places(), this.selected()) ?? this.places()[0]);
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

  private readonly picker = viewChild.required(PickerDialog);

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
    this.picker().open();
  }

  protected pickPlace(id: string) {
    this.query.set('');
    this.selected.set(id);
    this.openGroup.set(null);
  }

  protected pick(id: string) {
    this.picker().close();
    if (id !== this.value()) this.picked.emit(id);
  }

  protected pickFirst() {
    const first = this.query() ? this.matches()[0]?.signal : this.group()?.signals[0];
    if (first) this.pick(first.id);
  }
}
