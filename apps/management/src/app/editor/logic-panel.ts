import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TileSize } from '@homey-dash/layout';
import {
  alwaysRule,
  canHold,
  HeldTile,
  LogicTileSettings,
  TileData,
  TileKind,
  TileKindRegistry,
  TileSettings,
} from '@homey-dash/tiles';
import { describeRule } from './rule-text';
import { SignalCatalogue } from './signal-catalogue';
import { moved, RemoveButton, removedAt, ReorderButtons } from '@homey-dash/design-system';
import { TranslatePipe } from '@homey-dash/i18n';

/** Which of a logic tile's tiles is open in the panel: an entry's index, or its fallback. */
export type OpenEntry = number | 'fallback';

/**
 * A logic tile's own settings: the tiles it holds in order, each with its rule, its fallback and its minimum show time.
 * Opening a tile configures it, and its rule, as the panel does a tile on its own.
 */
@Component({
  selector: 'hd-logic-panel',
  imports: [ReorderButtons, RemoveButton, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <span class="hd-field__label">{{ 'Tiles' | t }}</span>
      <p class="hd-hint">{{ 'It shows the first whose rule holds.' | t }}</p>
      @for (entry of settings().entries; track $index; let i = $index, last = $last) {
        <div class="entry">
          <button type="button" class="entry__open" (click)="opened.emit(i)">
            <span class="entry__name" [class.missing]="!find(entry.tile)">{{ i + 1 }}. {{ name(entry.tile) }}</span>
            <span class="entry__rule">{{ describe(entry.rule) }}</span>
          </button>
          <hd-reorder-buttons [label]="name(entry.tile)" [first]="i === 0" [last]="last" (moved)="move(i, $event)" (removed)="remove(i)" />
        </div>
      }
      <select class="hd-select" [attr.aria-label]="'Add a tile' | t" (change)="add($any($event.target))">
        <option value="" selected>{{ 'Add a tile…' | t }}</option>
        @for (kind of holdable(); track kind.id) {
          <option [value]="kind.id">{{ kind.label }}</option>
        }
      </select>
    </div>

    <div class="hd-field">
      <span class="hd-field__label">{{ 'Fallback' | t }}</span>
      @if (settings().fallback; as fallback) {
        <div class="entry">
          <button type="button" class="entry__open" (click)="opened.emit('fallback')">
            <span class="entry__name" [class.missing]="!find(fallback)">{{ name(fallback) }}</span>
            <span class="entry__rule">{{ 'When no rule holds' | t }}</span>
          </button>
          <hd-remove-button [label]="'the fallback' | t" (removed)="patch({ fallback: null })" />
        </div>
      } @else {
        <p class="hd-hint">{{ 'Without one, it shows nothing when no rule holds.' | t }}</p>
        <select class="hd-select" [attr.aria-label]="'Add a fallback tile' | t" (change)="addFallback($any($event.target))">
          <option value="" selected>{{ 'Add a fallback tile…' | t }}</option>
          @for (kind of holdable(); track kind.id) {
            <option [value]="kind.id">{{ kind.label }}</option>
          }
        </select>
      }
    </div>

    <div class="hd-field">
      <label class="hd-field__label" for="logic-min-show">{{ 'Minimum show time' | t }}</label>
      <div class="seconds">
        <input
          id="logic-min-show"
          class="hd-input"
          type="number"
          min="0"
          step="1"
          [placeholder]="'Off' | t"
          [value]="settings().minShowSeconds || ''"
          (change)="setMinShow($any($event.target).value)"
        />
        <span>{{ 'seconds' | t }}</span>
      </div>
      <p class="hd-hint">{{ "Keeps a tile it switched to on screen at least this long, so it doesn't flicker." | t }}</p>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-4); }
    .entry { display: flex; align-items: center; gap: var(--space-1); }
    .entry__open {
      flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
      padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: inherit;
      font: inherit; text-align: left; cursor: pointer;
    }
    .entry__open:hover { border-color: var(--brand); }
    .entry__name, .entry__rule { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .entry__name { font-weight: 700; }
    .entry__name.missing { color: var(--danger); }
    .entry__rule { color: var(--ink-muted); font-size: 13px; }
    .seconds { display: flex; align-items: center; gap: var(--space-2); }
    .seconds .hd-input { flex: 1; }
  `,
})
export class LogicPanel {
  readonly settings = input.required<LogicTileSettings>();
  readonly size = input.required<TileSize>();

  readonly changed = output<LogicTileSettings>();
  readonly opened = output<OpenEntry>();

  private readonly kinds = inject(TileKindRegistry);
  private readonly data = inject(TileData);
  private readonly catalogue = inject(SignalCatalogue);

  /** The kinds it can hold at its size. */
  protected readonly holdable = computed(() => this.kinds.all().filter((kind) => canHold(kind, this.size())));

  protected find(tile: HeldTile): TileKind | undefined {
    return this.kinds.find(tile.kind);
  }

  /** Its label, or what it points at, or else its kind: "Floor lamp", "Photo tile". */
  protected name(tile: HeldTile): string {
    const kind = this.find(tile);
    if (!kind) return `Unknown tile "${tile.kind}"`;
    const { label, target, targets, account } = tile.settings;
    if (label) return label;
    const homey = this.data.homey(account);
    const named =
      kind.target === 'device' ? homey?.devices.get(target ?? '')?.name
      : kind.target === 'flow' ? homey?.flows.get(target ?? '')?.name
      : kind.target === 'mood' && !kind.multiple ? homey?.moods.get(target ?? '')?.name
      : undefined;
    if (kind.multiple) return `${kind.label} · ${targets?.length ?? 0}`;
    return named ? `${named} · ${kind.label}` : kind.label;
  }

  protected describe(rule: LogicTileSettings['entries'][number]['rule']) {
    return describeRule(rule, this.catalogue.byId());
  }

  protected patch(patch: Partial<LogicTileSettings>) {
    this.changed.emit({ ...this.settings(), ...patch });
  }

  private newTile(kindId: string): HeldTile | null {
    const kind = this.kinds.find(kindId);
    return kind ? { kind: kind.id, settings: structuredClone(kind.defaultSettings) as TileSettings } : null;
  }

  // A new tile starts with a rule that always holds, so it shows while it is set up.
  protected add(select: HTMLSelectElement) {
    const tile = this.newTile(select.value);
    select.value = '';
    if (!tile) return;
    const entries = [...(this.settings().entries ?? []), { tile, rule: alwaysRule() }];
    this.patch({ entries });
    this.opened.emit(entries.length - 1);
  }

  protected addFallback(select: HTMLSelectElement) {
    const tile = this.newTile(select.value);
    select.value = '';
    if (!tile) return;
    this.patch({ fallback: tile });
    this.opened.emit('fallback');
  }

  protected move(index: number, by: -1 | 1) {
    const entries = moved(this.settings().entries, index, by);
    this.patch({ entries });
  }

  protected remove(index: number) {
    this.patch({ entries: removedAt(this.settings().entries, index) });
  }

  protected setMinShow(value: string) {
    const seconds = Math.max(0, Math.round(Number(value) || 0));
    this.patch({ minShowSeconds: seconds });
  }
}
