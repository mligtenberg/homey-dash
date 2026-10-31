import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { RealtimeTileData } from '@homey-dash/tiles';
import { LucideDynamicIcon } from '@lucide/angular';
import { allOptions, entries, filterTree, findGroup, TargetNode } from './target-tree';

/**
 * Picks a tile's target: looks like a select, and opens a dialog with Homey's zones or flow folders on the left
 * and what is in the picked one on the right. The search narrows both as you type.
 */
@Component({
  selector: 'hd-target-picker',
  imports: [NgTemplateOutlet, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="hd-select trigger" [id]="pickerId()" [class.placeholder]="!value()" (click)="open()">
      {{ summary() }}
    </button>

    <dialog #dialog class="hd-panel" [attr.aria-label]="'Pick a ' + noun()" closedby="any" (close)="query.set('')">
      <div class="head">
        <input
          #search
          class="hd-input"
          type="search"
          [placeholder]="'Search ' + noun() + 's'"
          [attr.aria-label]="'Search ' + noun() + 's'"
          [value]="query()"
          (input)="find($any($event.target).value)"
          (keydown.enter)="$event.preventDefault(); pickFirst()"
        />
        <button type="button" class="hd-btn" (click)="dialog.close()">Cancel</button>
      </div>

      <div class="body">
        <nav [attr.aria-label]="groupNoun() + 's'">
          <button type="button" class="group" [attr.aria-current]="!group().id" (click)="selected.set(null)">
            <span>All {{ noun() }}s</span><span class="count">{{ count(shown()) }}</span>
          </button>
          <ng-container [ngTemplateOutlet]="groups" [ngTemplateOutletContext]="{ $implicit: shown().groups }" />
        </nav>

        <div class="list">
          @for (entry of rows(); track entry.option.id) {
            <button
              type="button"
              class="row"
              [attr.aria-current]="entry.option.id === value()"
              [style.--k-ink]="'var(--kind-' + entry.option.hue + '-ink)'"
              [style.--k-fill]="'var(--kind-' + entry.option.hue + '-fill)'"
              (click)="pick(entry.option.id)"
            >
              <span class="icon"><svg class="hd-icon" [lucideIcon]="entry.option.icon" /></span>
              <span class="text">
                <span class="name">{{ entry.option.label }}</span>
                <span class="type">
                  {{ entry.option.type }}@if (entry.group !== group() && entry.group.name) { · {{ entry.group.name }} }
                </span>
              </span>
            </button>
          } @empty {
            <p class="empty">
              {{
                query()
                  ? 'No ' + noun() + 's match "' + query() + '"'
                  : notSetUp()
                    ? "Homey isn't set up yet. Set it up under Accounts."
                    : 'Homey has no ' + noun() + 's'
              }}
            </p>
          }
        </div>
      </div>
    </dialog>

    <ng-template #groups let-nodes>
      @for (node of nodes; track node.id) {
        <button type="button" class="group" [attr.aria-current]="node.id === group().id" (click)="selected.set(node.id)">
          <span>{{ node.name }}</span><span class="count">{{ count(node) }}</span>
        </button>
        @if (node.groups.length) {
          <div class="nested">
            <ng-container [ngTemplateOutlet]="groups" [ngTemplateOutletContext]="{ $implicit: node.groups }" />
          </div>
        }
      }
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
    button.group, button.row {
      display: flex; align-items: center; gap: var(--space-3); width: 100%; text-align: left;
      font: 600 14px/1.3 var(--font-sans); color: var(--ink);
      padding: 8px 10px; border: 0; border-radius: var(--radius-control); background: none; cursor: pointer;
    }
    .group > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { font-size: 12px; color: var(--ink-muted); }
    :is(.group, .row):hover, :is(.group, .row):focus-visible {
      background: color-mix(in oklab, var(--brand) 10%, transparent); outline: none;
    }
    .group[aria-current='true'] { background: color-mix(in oklab, var(--brand) 16%, transparent); color: var(--brand); }
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
  protected readonly notSetUp = computed(() => this.homey.status()?.connection === 'notSetUp');
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

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');

  protected count(node: TargetNode) {
    return allOptions(node).length;
  }

  // Opens on the zone or folder of the current target.
  protected open() {
    this.selected.set(entries(this.tree()).find((e) => e.option.id === this.value())?.group.id || null);
    const dialog = this.dialog().nativeElement;
    dialog.showModal();
    this.search().nativeElement.focus();
    setTimeout(() => dialog.querySelector('.row[aria-current="true"]')?.scrollIntoView({ block: 'center' }));
  }

  // A search looks through everything; picking a zone or folder after it narrows the matches.
  protected find(query: string) {
    this.query.set(query);
    this.selected.set(null);
  }

  protected pick(id: string) {
    this.dialog().nativeElement.close();
    if (id !== this.value()) this.picked.emit(id);
  }

  protected pickFirst() {
    const [first] = this.rows();
    if (first) this.pick(first.option.id);
  }
}
