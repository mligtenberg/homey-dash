import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, ViewEncapsulation } from '@angular/core';
import { Tile } from '@homey-dash/api-client';
import { gridArea } from '@homey-dash/layout';
import { TileKindRegistry } from './tile-kind-registry';

/**
 * Places one tile on its section's grid and renders it with its kind's component. Content
 * projected into it (such as the editor's overlay) sits on top of the tile.
 */
@Component({
  selector: 'hd-tile-host',
  imports: [NgComponentOutlet],
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
  },
  template: `
    @if (kind(); as kind) {
      <ng-container *ngComponentOutlet="kind.component; inputs: { settings: tile().settings, size: tile().size }" />
    } @else {
      <div class="hd-tile is-missing" [attr.data-size]="tile().size">
        <span></span>
        <div>
          <div class="hd-tile__name">Unknown tile</div>
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

  protected readonly kind = computed(() => this.registry.find(this.tile().kind));
  protected readonly area = computed(() => gridArea(this.tile()));
}
