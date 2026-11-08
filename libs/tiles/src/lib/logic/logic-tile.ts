import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  InjectionToken,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Rule, Tile } from '@homey-dash/api-client';
import { TILE_SIZES, TileSize } from '@homey-dash/layout';
import { TileSettings } from '../tile-data';
import { TileHost } from '../tile-host';
import { TileKind, TileModule } from '../tile-kind';
import { TileKindRegistry } from '../tile-kind-registry';
import { ruleAnswersOf } from './rule-answers';

export * from './rule-answers';

// Mirrored for the API in apps/api/Rules/LogicTiles.cs and for assistants in apps/api/Mcp/ManagementTools.cs.

export const LOGIC_KIND = 'logic';

/** A tile a logic tile holds: any other kind with its own settings; it takes the logic tile's size. */
export interface HeldTile {
  kind: string;
  settings: TileSettings;
}

export interface LogicEntry {
  tile: HeldTile;
  rule: Rule;
}

export interface LogicTileSettings extends TileSettings {
  /** In order: the first whose rule holds is shown. */
  entries: LogicEntry[];
  /** Shown when no rule holds; without one, the logic tile shows nothing. */
  fallback: HeldTile | null;
  /** Keeps a tile it switched to on screen at least this long; 0 or absent for not at all. */
  minShowSeconds?: number;
}

/** Which tile a logic tile shows: an entry's index, its fallback, or nothing (null). */
export type LogicChoice = number | 'fallback' | null;

/** Set to true where a logic tile should say which of its tiles it shows, and hint when it has none: the Editor. */
export const LOGIC_TILE_BADGE = new InjectionToken<boolean>('LOGIC_TILE_BADGE', { factory: () => false });

/** Whether a logic tile of this size can hold a kind: never another logic tile, and only one that has the size. */
export function canHold(kind: TileKind, size: TileSize) {
  return kind.id !== LOGIC_KIND && kind.sizes.includes(size);
}

/** The tiles a logic tile holds, its fallback last. */
export function heldTiles(settings: LogicTileSettings): HeldTile[] {
  return [...(settings.entries ?? []).map((e) => e.tile), ...(settings.fallback ? [settings.fallback] : [])];
}

/** The sizes a logic tile can take: those that every kind it holds supports. */
export function logicSizes(settings: LogicTileSettings, registry: TileKindRegistry): TileSize[] {
  const held = heldTiles(settings);
  return ALL_SIZES.filter((size) => held.every((tile) => registry.supports(tile.kind, size)));
}

/** "2 of 3", "Fallback", "Nothing", or an ellipsis while the answers are on their way. */
export function choiceLabel(choice: LogicChoice | undefined, entries: number): string {
  if (choice === undefined) return '…';
  if (choice === 'fallback') return 'Fallback';
  return choice === null ? 'Nothing' : `${choice + 1} of ${entries}`;
}

/** A held tile placed as its logic tile, for the tile host. */
export function heldTile(id: string, tile: HeldTile, size: TileSize): Tile {
  return { id, kind: tile.kind, size, position: { column: 0, row: 0 }, settings: tile.settings };
}

/**
 * Shows the first of its tiles whose rule holds, else its fallback, else nothing, fading from one to the next. HomeyDash
 * answers each rule (ADR-0010); while an earlier rule has not answered yet, the tile keeps what it shows. Once it
 * switched, it stays at least the minimum show time, then shows whatever the rules choose at that moment.
 */
@Component({
  selector: 'hd-logic-tile',
  imports: [TileHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'hd-logic', '[attr.data-size]': 'size()' },
  template: `
    @for (tile of shownTiles(); track tile.id) {
      <div class="hd-logic__face" animate.enter="is-entering" animate.leave="is-leaving">
        <hd-tile-host [tile]="tile" />
      </div>
    }
    @if (badge) {
      @if (unconfigured() || !shownTiles().length) {
        <div class="hd-tile hd-logic__empty" [attr.data-size]="size()">
          <div class="hd-tile__name">Logic tile</div>
          <div class="hd-tile__detail">
            {{ unconfigured() ? 'Add tiles with rules; it shows the first whose rule holds.' : 'No rule holds right now, so it shows nothing.' }}
          </div>
        </div>
      }
      @if (!unconfigured()) {
        <span class="hd-logic-badge">{{ badgeLabel() }}</span>
      }
    }
  `,
  styles: `
    :host { flex: 1; position: relative; min-width: 0; min-height: 0; display: flex; }
    .hd-logic__face { position: absolute; inset: 0; display: flex; }
    .hd-logic__face > hd-tile-host { flex: 1; }
    /* Brand-tinted and dotted, so it reads as a logic tile rather than an add slot, on a plain stage or a photo. */
    .hd-logic__empty {
      flex: 1; justify-content: center;
      border: 2px dotted var(--brand);
      background: color-mix(in oklab, var(--brand) 12%, color-mix(in oklab, var(--panel) 60%, transparent));
      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
    }
    .hd-logic__empty .hd-tile__name { color: var(--brand); }
    .is-entering { animation: hd-logic-in 400ms ease both; }
    .is-leaving { animation: hd-logic-out 400ms ease both; }
    @keyframes hd-logic-in { from { opacity: 0; } }
    @keyframes hd-logic-out { to { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .is-entering, .is-leaving { animation-duration: 1ms; } }
  `,
})
export class LogicTile {
  readonly settings = input.required<LogicTileSettings>();
  readonly size = input.required<TileSize>();

  protected readonly badge = inject(LOGIC_TILE_BADGE);

  // Each entry's latest answer; editing a tile it holds doesn't subscribe again.
  private readonly heard = ruleAnswersOf(() => (this.settings().entries ?? []).map((e) => e.rule));

  /** What the rules choose now; undefined while an entry before the first that holds has not answered yet. */
  readonly choice = computed<LogicChoice | undefined>(() => {
    const heard = this.heard();
    const entries = this.settings().entries ?? [];
    for (let i = 0; i < entries.length; i++) {
      if (heard[i] === undefined) return undefined;
      if (heard[i]) return i;
    }
    return this.settings().fallback ? 'fallback' : null;
  });

  /** What it shows: the choice, held back by the minimum show time. */
  readonly shown = signal<LogicChoice | undefined>(undefined);
  private shownAt = 0;
  private timer?: ReturnType<typeof setTimeout>;

  protected readonly shownTiles = computed<Tile[]>(() => {
    const shown = this.shown();
    const settings = this.settings();
    const held = shown === 'fallback' ? settings.fallback : shown == null ? null : settings.entries?.[shown]?.tile;
    return held ? [heldTile(shown === 'fallback' ? 'fallback' : `entry-${shown}`, held, this.size())] : [];
  });

  protected readonly unconfigured = computed(() => !this.settings().entries?.length && !this.settings().fallback);
  protected readonly badgeLabel = computed(() => choiceLabel(this.shown(), this.settings().entries?.length ?? 0));

  constructor() {
    effect(() => {
      const choice = this.choice();
      const minMs = (this.settings().minShowSeconds ?? 0) * 1000;
      untracked(() => this.consider(choice, minMs));
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  private consider(choice: LogicChoice | undefined, minMs: number) {
    if (choice === undefined || choice === this.shown()) {
      clearTimeout(this.timer);
      this.timer = undefined;
      return;
    }
    const wait = this.shown() === undefined ? 0 : this.shownAt + minMs - Date.now();
    if (wait <= 0) this.show(choice);
    else this.timer ??= setTimeout(() => {
      this.timer = undefined;
      const now = this.choice();
      if (now !== undefined && now !== this.shown()) this.show(now);
    }, wait);
  }

  private show(choice: LogicChoice) {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.shown.set(choice);
    this.shownAt = Date.now();
  }
}

const ALL_SIZES = Object.keys(TILE_SIZES) as TileSize[];

const defaultSettings: LogicTileSettings = { target: null, entries: [], fallback: null, minShowSeconds: 0 };

export const LOGIC_TILES: TileModule = {
  name: 'Logic',
  kinds: [
    {
      id: LOGIC_KIND,
      label: 'Logic tile',
      target: 'none',
      sizes: ALL_SIZES,
      defaultSettings,
      component: LogicTile,
    },
  ],
};
