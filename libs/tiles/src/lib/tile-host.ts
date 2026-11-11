import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, ViewEncapsulation } from '@angular/core';
import { Tile } from '@homey-dash/api-client';
import { gridArea } from '@homey-dash/layout';
import { TileData, TileSettings } from './tile-data';
import { isHomeyTarget, TileKind } from './tile-kind';
import { TileKindRegistry } from './tile-kind-registry';
import { TranslatePipe } from '@homey-dash/i18n';

/**
 * Whether a tile shows what only a Homey that HomeyDash can't reach tells (`TileData.homeyLost`): something in it, or its
 * energy report. Not the weather, which comes from Open-Meteo whether the Homey is there or not.
 */
export function homeyLost(tile: Tile, kind: TileKind | undefined, data: TileData) {
  return !!kind && (isHomeyTarget(kind.target) || kind.target === 'energy') && data.homeyLost((tile.settings as TileSettings).account);
}

/**
 * Places one tile on its section's grid and renders it with its kind's component. Content
 * projected into it (such as the editor's overlay) sits on top of the tile. While the tile's Homey can't be reached it
 * has `is-homey-lost`, which locks it on displays.
 */
@Component({
  selector: 'hd-tile-host',
  imports: [NgComponentOutlet, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Not encapsulated, so the rule reaches the kind's component, which the outlet creates.
  encapsulation: ViewEncapsulation.None,
  styles: `
    .hd-tile-host { position: relative; display: flex; min-width: 0; min-height: 0; }
    .hd-tile-host > .hd-tile { flex: 1; min-width: 0; }
  `,
  host: {
    class: 'hd-tile-host',
    '[style.grid-column]': 'area().gridColumn',
    '[style.grid-row]': 'area().gridRow',
    '[class.is-homey-lost]': 'lost()',
  },
  template: `
    @if (kind(); as kind) {
      <ng-container *ngComponentOutlet="kind.component; inputs: inputs()" />
    } @else {
      <div class="hd-tile is-missing" [attr.data-size]="tile().size">
        <span></span>
        <div>
          <div class="hd-tile__name">{{ 'Unknown tile' | t }}</div>
          <div class="hd-tile__detail">Kind "{{ tile().kind }}" is not installed</div>
        </div>
      </div>
    }
    <ng-content />
  `,
})
export class TileHost {
  readonly tile = input.required<Tile>();

  private readonly registry = inject(TileKindRegistry);
  private readonly data = inject(TileData);

  protected readonly kind = computed(() => this.registry.find(this.tile().kind));
  protected readonly lost = computed(() => homeyLost(this.tile(), this.kind(), this.data));
  protected readonly area = computed(() => gridArea(this.tile()));

  // `detailView` only where the kind turns it off, so a kind's component need not declare it.
  protected readonly inputs = computed(() => {
    const { settings, size } = this.tile();
    return this.kind()?.details === false ? { settings, size, detailView: false } : { settings, size };
  });
}
