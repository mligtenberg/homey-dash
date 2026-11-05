import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChildren,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { DashboardBackground, DashboardDetail, DashboardLayout, DashboardsApi, DisplaysApi, Rule, Tile } from '@homey-dash/api-client';
import { TilePosition, TileSize } from '@homey-dash/layout';
import {
  alwaysRule,
  backgroundSignal,
  choiceLabel,
  hasImage,
  heldTile,
  HeldTile,
  LOGIC_KIND,
  LOGIC_TILE_BADGE,
  LogicTileSettings,
  logicSizes,
  shownSections,
  TileHost,
  TileKind,
  TileKindRegistry,
  TileSettings,
} from '@homey-dash/tiles';
import { BackgroundField } from './background-field';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideDynamicIcon,
  LucideEye,
  LucideEyeOff,
  LucideScanEye,
  LucidePlus,
  LucideTrash,
} from '@lucide/angular';
import { firstValueFrom, Subscription } from 'rxjs';
import { AsDisplayPicker } from '../as-display-picker';
import { DashboardsStore } from '../dashboards-store';
import * as edits from './draft-edits';
import { LogicPanel, OpenEntry } from './logic-panel';
import { RuleEditor } from './rule-editor';
import { TilePanel } from './tile-panel';

const SAVE_DELAY_MS = 400;
const DRAG_THRESHOLD_PX = 4;
const MAX_ROWS = 12;

interface Drag {
  tileId: string;
  mode: 'move' | 'resize';
  /** The cell within the tile where it was grabbed, so the tile keeps its offset under the pointer. */
  grab: TilePosition;
  start: { x: number; y: number };
  moved: boolean;
  candidate: DashboardLayout | null;
}

@Component({
  selector: 'hd-editor-page',
  imports: [AsDisplayPicker, BackgroundField, LogicPanel, RouterLink, RuleEditor, TileHost, TilePanel, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Logic tiles say which of their tiles they show.
  providers: [{ provide: LOGIC_TILE_BADGE, useValue: true }],
  templateUrl: './editor-page.html',
  styleUrl: './editor-page.scss',
})
export class EditorPage {
  readonly id = input.required<string>();

  private readonly api = inject(DashboardsApi);
  private readonly displays = inject(DisplaysApi);
  private readonly store = inject(DashboardsStore);
  private readonly router = inject(Router);
  protected readonly kinds = inject(TileKindRegistry);

  protected readonly icons = { LucidePlus, LucideChevronLeft, LucideChevronRight, LucideEye, LucideEyeOff, LucideScanEye, LucideTrash };
  protected readonly rowChoices = Array.from({ length: MAX_ROWS }, (_, i) => i + 1);

  protected readonly dashboard = signal<DashboardDetail | null>(null);
  protected readonly draft = signal<DashboardLayout | null>(null);
  protected readonly selectedTileId = signal<string | null>(null);
  protected readonly adding = signal<{ sectionId: string; position: TilePosition } | null>(null);
  protected readonly saveState = signal<'saved' | 'pending' | 'saving' | 'error'>('saved');
  protected readonly refused = signal<string | null>(null);
  /** Why the draft couldn't be saved, such as an invalid rule. */
  protected readonly saveError = signal<string | null>(null);
  /** Which of the selected logic tile's tiles is open in the panel. */
  protected readonly openEntry = signal<OpenEntry | null>(null);
  /** The section whose visibility is open in the panel. */
  protected readonly openSectionId = signal<string | null>(null);
  protected readonly justPublished = signal(false);
  private readonly drag = signal<Drag | null>(null);

  private readonly grids = viewChildren<ElementRef<HTMLElement>>('grid');
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> = Promise.resolve();
  private inFlight = false;

  /** What the stage shows: the draft, or where a tile would land while it is being dragged. */
  protected readonly view = computed(() => this.drag()?.candidate ?? this.draft());

  /** The draft; only called once the dashboard has loaded, as the template renders nothing before. */
  private current(): DashboardLayout {
    const draft = this.draft();
    if (!draft) throw new Error('The draft has not loaded yet');
    return draft;
  }

  private loadedDashboard(): DashboardDetail {
    const dashboard = this.dashboard();
    if (!dashboard) throw new Error('The dashboard has not loaded yet');
    return dashboard;
  }

  /** The stage's layout, in the template. */
  protected readonly layout = computed(() => this.view() ?? { rows: 4, sections: [] });

  protected readonly openSection = computed(() => this.layout().sections.find((s) => s.id === this.openSectionId()) ?? null);

  /** The sections a display would show now, as the Preview would; the stage dims the others. */
  protected readonly shown = shownSections(() => this.layout().sections);

  protected readonly selected = computed(() => {
    const id = this.selectedTileId();
    const draft = this.draft();
    return id && draft ? edits.findTile(draft, id) : null;
  });

  /** The selected tile's settings when it is a logic tile. */
  protected readonly logic = computed(() => {
    const tile = this.selected()?.tile;
    return tile?.kind === LOGIC_KIND ? (tile.settings as LogicTileSettings) : null;
  });

  /** The tile of the selected logic tile that is open in the panel, as the stage shows it while it is configured. */
  protected readonly open = computed(() => {
    const logic = this.logic();
    const open = this.openEntry();
    const tile = this.selected()?.tile;
    if (!logic || open === null || !tile) return null;
    const held = open === 'fallback' ? logic.fallback : logic.entries?.[open]?.tile;
    if (!held) return null;
    return {
      tileId: tile.id,
      held,
      view: heldTile(`${tile.id}/${open}`, held, tile.size),
      rule: open === 'fallback' ? null : logic.entries[open].rule,
      label: open === 'fallback' ? 'Fallback' : choiceLabel(open, logic.entries.length),
    };
  });

  // The open tile in its logic tile's place, kept while neither changes so the stage doesn't render it again.
  private staged: { from: Tile; held: HeldTile; tile: Tile } | null = null;

  /** What the stage renders for a tile: the tile, or the open tile of a logic tile in its place. */
  protected stageTile(tile: Tile): Tile {
    const open = this.open();
    if (open?.tileId !== tile.id) return tile;
    if (this.staged?.from !== tile || this.staged.held !== open.held)
      this.staged = { from: tile, held: open.held, tile: { ...tile, kind: open.held.kind, settings: open.held.settings } };
    return this.staged.tile;
  }

  /** The sizes a tile can take: its kind's, or for a logic tile those of every tile it holds. */
  protected sizesOf(tile: Tile) {
    return tile.kind === LOGIC_KIND ? logicSizes(tile.settings as LogicTileSettings, this.kinds) : (this.kindOf(tile)?.sizes ?? []);
  }

  protected readonly unpublished = computed(
    () => this.saveState() !== 'saved' || (this.dashboard()?.hasUnpublishedChanges ?? false),
  );

  constructor() {
    effect((onCleanup) => {
      const loading: Subscription = this.api.get(this.id()).subscribe((dashboard) => {
        this.dashboard.set(dashboard);
        this.draft.set(dashboard.draft);
        this.saveState.set('saved');
        this.selectedTileId.set(null);
        this.openEntry.set(null);
        this.openSectionId.set(null);
        this.adding.set(null);
      });
      onCleanup(() => {
        loading.unsubscribe();
        this.flush();
      });
    });
  }

  // ---------- Editing ----------

  /** Applies an edit to the draft and saves it shortly after; an edit that breaks the layout is refused. */
  protected apply(next: DashboardLayout | null, refusal = "That doesn't fit there") {
    if (!next) {
      this.refused.set(refusal);
      setTimeout(() => this.refused.set(null), 2000);
      return;
    }
    this.refused.set(null);
    this.draft.set(next);
    this.saveState.set('pending');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  private flush(): Promise<void> {
    // One save at a time, so they arrive in order; the one in flight saves again when it ends.
    if (this.saveState() !== 'pending' || this.inFlight) return this.saving;
    clearTimeout(this.saveTimer);
    this.inFlight = true;
    const id = this.loadedDashboard().id;
    const draft = this.current();
    this.saveState.set('saving');
    this.saving = firstValueFrom(this.api.saveDraft(id, draft)).then(
      (saved) => {
        this.inFlight = false;
        this.store.upsert(saved);
        if (this.dashboard()?.id !== id) return Promise.resolve();
        this.dashboard.set(saved);
        // Edits made while this save was in flight still need saving.
        this.saveError.set(null);
        if (this.draft() !== draft) return this.flush();
        this.saveState.set('saved');
        return Promise.resolve();
      },
      (error: unknown) => {
        this.inFlight = false;
        this.saveError.set(problem(error));
        this.saveState.set('error');
      },
    );
    return this.saving;
  }

  protected kindOf(tile: Tile): TileKind | undefined {
    return this.kinds.find(tile.kind);
  }

  protected emptyCells(sectionId: string): TilePosition[] {
    const layout = this.layout();
    const section = layout.sections.find((s) => s.id === sectionId);
    return section ? edits.emptyCells(layout, section) : [];
  }

  protected startAdding(sectionId: string, position: TilePosition) {
    this.selectedTileId.set(null);
    this.openSectionId.set(null);
    this.adding.set({ sectionId, position });
  }

  protected canAdd(kind: TileKind): boolean {
    const at = this.adding();
    return !!at && kind.sizes.some((size) => edits.fits(this.current(), at.sectionId, at.position, size));
  }

  protected add(kind: TileKind) {
    const at = this.adding();
    if (!at) return;
    const result = edits.addTile(this.current(), at.sectionId, at.position, kind);
    this.apply(result?.layout ?? null);
    if (result) {
      this.adding.set(null);
      this.selectedTileId.set(result.tileId);
    }
  }

  protected select(tileId: string | null) {
    this.adding.set(null);
    this.openSectionId.set(null);
    if (tileId !== this.selectedTileId()) this.openEntry.set(null);
    this.selectedTileId.set(tileId);
  }

  protected fitsSize = computed(() => {
    const selected = this.selected();
    const draft = this.draft();
    return (size: TileSize) =>
      !!selected && !!draft && edits.fits(draft, selected.section.id, selected.tile.position, size, selected.tile.id);
  });

  protected updateSettings(tileId: string, settings: TileSettings) {
    this.apply(edits.updateTile(this.current(), tileId, (t) => ({ ...t, settings })));
  }

  protected updateLogic(tileId: string, change: (logic: LogicTileSettings) => LogicTileSettings) {
    this.apply(edits.updateTile(this.current(), tileId, (t) => ({ ...t, settings: change(t.settings as LogicTileSettings) })));
  }

  /** Changes the open tile of a logic tile: its settings, or its rule. */
  protected updateOpen(tileId: string, change: { settings?: TileSettings; rule?: Rule }) {
    const open = this.openEntry();
    if (open === null) return;
    this.updateLogic(tileId, (logic) =>
      open === 'fallback'
        ? { ...logic, fallback: logic.fallback && change.settings ? { ...logic.fallback, settings: change.settings } : logic.fallback }
        : {
            ...logic,
            entries: logic.entries.map((e, i) =>
              i === open ? { tile: change.settings ? { ...e.tile, settings: change.settings } : e.tile, rule: change.rule ?? e.rule } : e,
            ),
          },
    );
  }

  protected removeOpen(tileId: string) {
    const open = this.openEntry();
    if (open === null) return;
    this.openEntry.set(null);
    this.updateLogic(tileId, (logic) =>
      open === 'fallback' ? { ...logic, fallback: null } : { ...logic, entries: logic.entries.filter((_, i) => i !== open) },
    );
  }

  protected resize(tileId: string, size: TileSize) {
    this.apply(edits.resizeTile(this.current(), tileId, size));
  }

  protected removeTile(tileId: string) {
    this.apply(edits.removeTile(this.current(), tileId));
    this.selectedTileId.set(null);
  }

  protected addSection() {
    this.apply(edits.addSection(this.current(), 'New section').layout);
  }

  protected renameSection(sectionId: string, title: string) {
    this.apply(edits.renameSection(this.current(), sectionId, title.trim()));
  }

  /** Opens a section's visibility in the panel, or closes it when it is open. */
  protected toggleSectionPanel(sectionId: string) {
    const opening = this.openSectionId() !== sectionId;
    this.selectedTileId.set(null);
    this.adding.set(null);
    this.openSectionId.set(opening ? sectionId : null);
  }

  protected setVisibility(sectionId: string, choice: 'always' | 'never' | 'rule') {
    const rule = choice === 'rule' ? (this.openSection()?.rule ?? alwaysRule()) : null;
    this.apply(edits.setSectionVisibility(this.current(), sectionId, { hidden: choice === 'never', rule }));
  }

  protected setSectionRule(sectionId: string, rule: Rule) {
    this.apply(edits.setSectionVisibility(this.current(), sectionId, { rule }));
  }

  protected moveSection(sectionId: string, by: -1 | 1) {
    this.apply(edits.moveSection(this.current(), sectionId, by));
  }

  protected removeSection(sectionId: string, title: string, tiles: number) {
    if (tiles > 0 && !confirm(`Remove the section "${title || 'Untitled'}" and its ${tiles} tile(s)?`)) return;
    if (this.selected()?.section.id === sectionId) this.selectedTileId.set(null);
    if (this.adding()?.sectionId === sectionId) this.adding.set(null);
    if (this.openSectionId() === sectionId) this.openSectionId.set(null);
    this.apply(edits.removeSection(this.current(), sectionId));
  }

  // A background being picked on the colour wheel shows on the stage before it is let go of and saved.
  protected readonly previewBackground = signal<DashboardBackground | null>(null);
  protected readonly stageBackground = backgroundSignal(() => this.previewBackground() ?? this.layout().background);
  protected readonly stageHasImage = computed(() => hasImage(this.layout().background));

  protected setBackground(background: DashboardBackground | null) {
    this.previewBackground.set(null);
    this.apply({ ...this.current(), background });
  }

  protected setRows(rows: number) {
    this.apply(edits.setRows(this.current(), rows), 'Move the tiles in the bottom rows first');
  }

  protected rowsFit(rows: number): boolean {
    return edits.setRows(this.current(), rows) !== null;
  }

  // ---------- Dashboard ----------

  protected rename(name: string) {
    const dashboard = this.loadedDashboard();
    if (!name.trim() || name.trim() === dashboard.name) return;
    this.api.rename(dashboard.id, name).subscribe((renamed) => {
      this.dashboard.update((d) => (d ? { ...d, name: renamed.name } : d));
      this.store.upsert(renamed);
    });
  }

  protected async deleteDashboard() {
    const dashboard = this.loadedDashboard();
    const showing = (await firstValueFrom(this.displays.list())).filter(
      (d) => d.dashboardIds.includes(dashboard.id),
    );
    const stopping = showing.length
      ? ` ${showing.map((d) => `"${d.name}"`).join(', ')} will stop showing it.`
      : '';
    if (!confirm(`Delete the dashboard "${dashboard.name}"? This can't be undone.${stopping}`)) return;
    clearTimeout(this.saveTimer);
    this.saveState.set('saved');
    this.api.delete(dashboard.id).subscribe(() => {
      this.store.remove(dashboard.id);
      this.router.navigate(['/']);
    });
  }

  protected async publish() {
    await this.flush();
    if (this.saveState() === 'error') return;
    const published = await firstValueFrom(this.api.publish(this.loadedDashboard().id));
    this.dashboard.set(published);
    this.store.upsert(published);
    this.justPublished.set(true);
    setTimeout(() => this.justPublished.set(false), 2500);
  }

  // ---------- Dragging and keyboard ----------

  /** The section and cell under a point, measured from the rendered grids. */
  private cellAt(x: number, y: number): { sectionId: string; cell: TilePosition } | null {
    const rows = this.current().rows;
    for (const { nativeElement: grid } of this.grids()) {
      const rect = grid.getBoundingClientRect();
      // A grid is 3 cells and 2 gaps wide, and a gap is 0.08 of a cell.
      const pitch = (rect.width / (3 + 2 * 0.08)) * 1.08;
      if (x < rect.left - pitch / 2 || x > rect.right + pitch / 2) continue;
      const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
      return {
        sectionId: grid.dataset['section'] ?? '',
        cell: { column: clamp(Math.floor((x - rect.left) / pitch), 2), row: clamp(Math.floor((y - rect.top) / pitch), rows - 1) },
      };
    }
    return null;
  }

  protected startDrag(event: PointerEvent, tile: Tile, mode: Drag['mode']) {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.select(tile.id);
    const at = this.cellAt(event.clientX, event.clientY);
    const grab = at && mode === 'move'
      ? { column: at.cell.column - tile.position.column, row: at.cell.row - tile.position.row }
      : { column: 0, row: 0 };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag.set({ tileId: tile.id, mode, grab, start: { x: event.clientX, y: event.clientY }, moved: false, candidate: null });
  }

  protected onPointerMove(event: PointerEvent) {
    const drag = this.drag();
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < DRAG_THRESHOLD_PX) return;
    const at = this.cellAt(event.clientX, event.clientY);
    const draft = this.current();
    const found = edits.findTile(draft, drag.tileId);
    if (!at || !found) return;

    let candidate: DashboardLayout | null;
    if (drag.mode === 'move') {
      const position = { column: at.cell.column - drag.grab.column, row: at.cell.row - drag.grab.row };
      candidate = edits.moveTile(draft, drag.tileId, at.sectionId, position);
    } else {
      const { position } = found.tile;
      const wanted = { columns: at.cell.column - position.column + 1, rows: at.cell.row - position.row + 1 };
      const size = edits.closestSize(draft, drag.tileId, this.sizesOf(found.tile), wanted);
      candidate = size ? edits.resizeTile(draft, drag.tileId, size) : null;
    }
    // Keep showing the last valid spot while the pointer is over one that isn't.
    this.drag.set({ ...drag, moved: true, candidate: candidate ?? drag.candidate });
  }

  protected onPointerUp() {
    const drag = this.drag();
    this.drag.set(null);
    if (drag?.moved && drag.candidate) this.apply(drag.candidate);
  }

  protected onTileKey(event: KeyboardEvent, tile: Tile, sectionId: string) {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.key in step) {
      event.preventDefault();
      const [dc, dr] = step[event.key];
      const position = { column: tile.position.column + dc, row: tile.position.row + dr };
      this.apply(edits.moveTile(this.current(), tile.id, sectionId, position));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.removeTile(tile.id);
    } else if (event.key === 'Escape') {
      this.select(null);
    }
  }
}

/** What the API said is wrong with a draft it refused, such as an invalid rule; null when it said nothing. */
function problem(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const errors = error.error?.errors as Record<string, string[]> | undefined;
  return errors ? Object.values(errors).flat().join(' ') : null;
}
