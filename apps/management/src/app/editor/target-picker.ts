import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { RealtimeTileData } from '@homey-dash/tiles';
import { PickerDialog, PickerRow } from './picker-dialog';
import { allOptions, entries, filterTree, findGroup, TargetNode } from './target-tree';

/**
 * Picks a tile's target: looks like a select, and opens a dialog with Homey's zones or flow folders on the left
 * and what is in the picked one on the right. The search narrows both as you type.
 */
@Component({
  selector: 'hd-target-picker',
  imports: [NgTemplateOutlet, PickerDialog, PickerRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-picker-dialog
      #picker
      [triggerId]="pickerId()"
      [label]="'Pick a ' + noun()"
      [searchLabel]="'Search ' + noun() + 's'"
      [navLabel]="groupNoun() + 's'"
      [summary]="summary()"
      [placeholder]="!value()"
      [query]="query()"
      (queryChange)="find($event)"
      (opening)="open()"
      (enter)="pickFirst()"
    >
      <ng-container ngProjectAs="[pickerNav]">
        <button type="button" class="hd-picker__group" [attr.aria-current]="!group().id" (click)="selected.set(null)">
          <span>All {{ noun() }}s</span><span class="hd-picker__count">{{ count(shown()) }}</span>
        </button>
        <ng-container [ngTemplateOutlet]="groups" [ngTemplateOutletContext]="{ $implicit: shown().groups }" />
      </ng-container>

      @for (entry of rows(); track entry.option.id) {
        <hd-picker-row
          [icon]="entry.option.icon"
          [hue]="entry.option.hue"
          [name]="entry.option.label"
          [detail]="entry.option.type + (entry.group !== group() && entry.group.name ? ' · ' + entry.group.name : '')"
          [current]="entry.option.id === value()"
          (pressed)="pick(entry.option.id)"
        />
      } @empty {
        <p class="hd-picker__empty">
          {{
            query()
              ? 'No ' + noun() + 's match "' + query() + '"'
              : notSetUp()
                ? "Homey isn't set up yet. Set it up under Accounts."
                : 'Homey has no ' + noun() + 's'
          }}
        </p>
      }
    </hd-picker-dialog>

    <ng-template #groups let-nodes>
      @for (node of nodes; track node.id) {
        <button type="button" class="hd-picker__group" [attr.aria-current]="node.id === group().id" (click)="selected.set(node.id)">
          <span>{{ node.name }}</span><span class="hd-picker__count">{{ count(node) }}</span>
        </button>
        @if (node.groups.length) {
          <div class="hd-picker__nested">
            <ng-container [ngTemplateOutlet]="groups" [ngTemplateOutletContext]="{ $implicit: node.groups }" />
          </div>
        }
      }
    </ng-template>
  `,
})
export class TargetPicker {
  readonly pickerId = input.required<string>();
  readonly tree = input.required<TargetNode>();
  readonly value = input.required<string | null>();
  /** What a target is called: device, flow, mood. */
  readonly noun = input.required<string>();
  /** What the tree's groups are called: zone, folder. */
  readonly groupNoun = input.required<string>();
  readonly picked = output<string>();

  protected readonly query = signal('');
  private readonly homey = inject(RealtimeTileData);
  protected readonly notSetUp = computed(() => this.homey.homeys()?.length === 0);
  /** The zone or folder picked on the left; null for all of them. */
  protected readonly selected = signal<string | null>(null);

  protected readonly shown = computed(() => filterTree(this.tree(), this.query()));
  // A picked group the search leaves out shows everything that matches.
  protected readonly group = computed(() => findGroup(this.shown(), this.selected()) ?? this.shown());
  protected readonly rows = computed(() => entries(this.group()));

  protected readonly summary = computed(() => {
    const value = this.value();
    if (!value) return `Pick a ${this.noun()}`;
    const option = allOptions(this.tree()).find((o) => o.id === value);
    return option ? (option.summary ?? option.label) : 'Not found in Homey';
  });

  private readonly picker = viewChild.required(PickerDialog);

  protected count(node: TargetNode) {
    return allOptions(node).length;
  }

  // Opens on the zone or folder of the current target.
  protected open() {
    this.selected.set(entries(this.tree()).find((e) => e.option.id === this.value())?.group.id || null);
    this.picker().open();
  }

  // A search looks through everything; picking a zone or folder after it narrows the matches.
  protected find(query: string) {
    this.query.set(query);
    this.selected.set(null);
  }

  protected pick(id: string) {
    this.picker().close();
    if (id !== this.value()) this.picked.emit(id);
  }

  protected pickFirst() {
    const [first] = this.rows();
    if (first) this.pick(first.option.id);
  }
}
