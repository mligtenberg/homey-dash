import { Directive, inject, input, Signal } from '@angular/core';
import { LucideIconInput } from '@lucide/angular';
import { TileSize } from '@homey-dash/layout';
import { TileData, TileSettings } from '../tile-data';
import { KindHue } from '../tile-kind';

/** What a basic tile shows; the core kinds differ only in how they derive it from their target. */
export interface TileFace {
  name: string;
  detail: string;
  icon: LucideIconInput;
  hue: KindHue;
  active?: boolean;
  /** `unset`: no target picked yet; `loading`: Homey's data has not arrived. */
  state: 'ok' | 'unavailable' | 'missing' | 'unset' | 'loading';
}

// Shared by the core kinds' components, whose host element is the tile itself.
export const TILE_FACE_HOST = {
  class: 'hd-tile',
  '[attr.data-size]': 'size()',
  '[attr.data-kind]': "face().state === 'missing' || face().hue === 'neutral' ? null : face().hue",
  '[class.is-active]': "face().active && face().state === 'ok'",
  '[class.is-unavailable]': "face().state === 'unavailable'",
  '[class.is-missing]': "face().state === 'missing'",
};

export const TILE_FACE_TEMPLATE = `
  <svg class="hd-icon" [lucideIcon]="face().icon" />
  <div>
    <div class="hd-tile__name">{{ face().name }}</div>
    <div class="hd-tile__detail">{{ face().detail }}</div>
  </div>
  @if (face().state === 'unavailable') {
    <span class="hd-badge">Unavailable</span>
  }
`;

@Directive()
export abstract class TileView<TSettings extends TileSettings = TileSettings> {
  readonly settings = input.required<TSettings>();
  readonly size = input.required<TileSize>();

  protected readonly data = inject(TileData);

  abstract readonly face: Signal<TileFace>;

  /** The face of a tile whose target is not in Homey's data: not picked yet, not loaded yet, or missing. */
  protected absentFace(base: Pick<TileFace, 'icon' | 'hue'> & { noun: string }): TileFace {
    const { target, label } = this.settings();
    const { noun, ...look } = base;
    const name = label || noun;
    if (!target) return { ...look, name, detail: `Pick a ${noun.toLowerCase()}`, state: 'unset' };
    if (!this.data.loaded()) return { ...look, name, detail: '…', state: 'loading' };
    return { ...look, name, detail: 'Not found in Homey', state: 'missing' };
  }
}
