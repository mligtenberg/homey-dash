import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { DashboardsApi, DisplayInfo } from '@homey-dash/api-client';
import { cellSize, sectionsPerPage, TILE_SIZES } from '@homey-dash/layout';
import { backgroundStyle } from '@homey-dash/tiles';
import { of } from 'rxjs';
import { DashboardsStore } from '../dashboards-store';
import { DisplaysStore } from './displays-store';
import { TranslatePipe, t } from '@homey-dash/i18n';

export type DisplayHealth = 'ok' | 'stale' | 'none' | 'lost';

/** How a display is doing, in a word and a tone: connected, seen a while ago, never seen, or without a screen. */
export function displayHealth(display: DisplayInfo, store: DisplaysStore): { tone: DisplayHealth; text: string } {
  const status = display.status;
  if (!status.held) return { tone: 'lost', text: t('No screen') };
  if (status.connected) return { tone: 'ok', text: t('Connected') };
  if (!status.lastSeenAt) return { tone: 'none', text: t('Never connected') };
  return { tone: 'stale', text: t('Last seen {ago}', { ago: store.ago(status.lastSeenAt) }) };
}

/**
 * A display drawn as a screen, as on a plan of the home: a framed outline with the dashboard it starts on inside,
 * how many more it offers, and below it its name and how it is doing.
 */
@Component({
  selector: 'hd-display-sketch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sketch', '[class.is-empty]': '!first()', '[attr.data-tone]': 'health().tone' },
  imports: [TranslatePipe],
  template: `
    <div class="screen" aria-hidden="true">
      <div class="glass" [class.mini]="!!miniature()" [style.background]="miniature() ? miniature()!.background : null">
        @if (miniature(); as mini) {
          @for (section of mini.sections; track section.id) {
            <div class="sec" [style.aspect-ratio]="'3 / ' + mini.rows" [style.grid-template-rows]="'repeat(' + mini.rows + ', 1fr)'">
              @for (tile of section.tiles; track tile.id) {
                <i [style.grid-column]="tile.column" [style.grid-row]="tile.row"></i>
              }
            </div>
          }
          @if (more() > 0) {
            <span class="badge">+{{ more() }}</span>
          }
        } @else if (first(); as first) {
          <span class="shows">{{ first }}</span>
          @if (more() > 0) {
            <span class="more">+{{ more() }} more</span>
          }
        } @else {
          <span class="shows">{{ 'No dashboard' | t }}</span>
        }
        <span class="name">{{ display().name }}</span>
      </div>
    </div>
    @if (state()) {
      <span class="state"><i></i>{{ health().text }}</span>
    }
    <span class="sr-only">{{ display().name }}: {{ first() ? 'shows ' + first() + (more() ? ' and ' + more() + ' more' : '') : 'shows no dashboard yet' }}</span>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .screen {
      width: min(100%, var(--screen-max, 100%)); align-self: center;
      aspect-ratio: 16 / 10; box-sizing: border-box; padding: 6px; margin-bottom: 8px;
      border: 1.5px solid var(--ink-soft); border-radius: 8px; background: var(--panel);
      transition: border-color .15s, translate .2s cubic-bezier(.2, 0, 0, 1);
    }
    .glass {
      height: 100%; box-sizing: border-box; padding: 6px 10px;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; text-align: center;
      border: 1px solid var(--line); border-radius: 3px;
      background: color-mix(in oklab, var(--sec-displays) 9%, var(--panel));
    }
    .glass { position: relative; }
    .glass.mini { flex-direction: row; gap: 8px; padding: 5px; }
    .sec { height: 100%; min-width: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; }
    .sec i { border-radius: 2px; background: color-mix(in oklab, var(--ink) 22%, transparent); box-shadow: inset 0 0 0 .5px color-mix(in oklab, var(--ink) 20%, transparent); }
    .badge { position: absolute; right: 4px; bottom: 3px; font-size: 11px; font-weight: 600; line-height: 1; padding: 2px 4px; border-radius: 6px; color: var(--ink); background: color-mix(in oklab, var(--panel) 80%, transparent); }
    .shows { font-weight: 600; font-size: 14px; line-height: 1.2; color: var(--sec-dashboards); text-wrap: balance; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .more { font-size: 12px; color: var(--ink-muted); }
    :host(.is-empty) .screen { border-style: dashed; border-color: var(--line-strong); }
    :host(.is-empty) .glass { background: none; border-style: dashed; }
    :host(.is-empty) .shows { color: var(--ink-muted); font-weight: 500; }
    .name { position: absolute; left: 6px; top: 5px; max-width: calc(100% - 12px); font-weight: 600; font-size: 13px; line-height: 1.2; padding: 2px 7px; border-radius: 6px; color: var(--ink); background: color-mix(in oklab, var(--panel) 82%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .state { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-muted); }
    .state i { width: 7px; height: 7px; border-radius: 50%; background: var(--line-strong); flex: none; }
    :host([data-tone='ok']) .state { color: var(--ok); }
    :host([data-tone='ok']) .state i { background: var(--ok); }
    :host([data-tone='stale']) .state, :host([data-tone='lost']) .state { color: var(--warn); }
    :host([data-tone='stale']) .state i, :host([data-tone='lost']) .state i { background: var(--warn); }
    :host-context(a:hover) .screen { border-color: var(--sec-displays); translate: 0 -2px; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    @media (prefers-reduced-motion: reduce) { .screen { transition: none; } }
  `,
})
export class DisplaySketch {
  private readonly store = inject(DisplaysStore);
  readonly display = input.required<DisplayInfo>();
  /** False where the full status (versions, Fully Kiosk, light) shows beside it instead. */
  readonly state = input(true);

  protected readonly first = computed(() => {
    const id = this.display().dashboardIds[0];
    return id ? this.store.dashboardName(id) : null;
  });
  protected readonly more = computed(() => Math.max(0, this.display().dashboardIds.length - 1));
  private readonly dashboardsApi = inject(DashboardsApi);
  private readonly dashboardList = inject(DashboardsStore).list;

  /** The published layout of the dashboard it starts on, fetched again when that dashboard is published anew. */
  private readonly layout = rxResource({
    params: () => {
      const id = this.display().dashboardIds[0];
      const version = this.dashboardList().find((d) => d.id === id)?.publishedVersion;
      return id && version ? { id, version } : undefined;
    },
    stream: ({ params }) => (params ? this.dashboardsApi.get(params.id) : of(null)),
  });

  /** What it shows, drawn small: its first page of sections, each tile a block, on the dashboard's own background. */
  protected readonly miniature = computed(() => {
    const layout = this.layout.value()?.published;
    if (!layout) return null;
    const details = this.display().status.details;
    const [width, height] = [details?.screenWidth || 1280, details?.screenHeight || 800];
    const perPage = sectionsPerPage(width, cellSize(height, layout.rows));
    const sections = layout.sections
      .filter((s) => !s.hidden && s.tiles.length)
      .slice(0, perPage)
      .map((s) => ({
        id: s.id,
        tiles: s.tiles.map((t) => ({
          id: t.id,
          column: `${t.position.column + 1} / span ${TILE_SIZES[t.size].columns}`,
          row: `${t.position.row + 1} / span ${TILE_SIZES[t.size].rows}`,
        })),
      }));
    return sections.length ? { rows: layout.rows, sections, background: backgroundStyle(layout.background) } : null;
  });
  protected readonly health = computed(() => displayHealth(this.display(), this.store));
}
