import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders, Type } from '@angular/core';
import { TileSize } from '@homey-dash/layout';

/** The hue a tile takes from the design system's kind tokens (`data-kind`). */
export type KindHue =
  | 'light'
  | 'heat'
  | 'flow'
  | 'mood'
  | 'security'
  | 'energy'
  | 'cover'
  | 'appliance'
  | 'climate'
  | 'neutral';

/** What a tile kind points at in Homey. */
export type TargetType = 'device' | 'flow' | 'mood' | 'insight';

/**
 * A category of tile, registered by exactly one module.
 *
 * `component` renders the tile on displays and in Management. It receives the tile's
 * `settings` and `size` as inputs, and uses only relative units so it scales with the cell.
 */
export interface TileKind<TSettings = unknown> {
  /** Stored on every tile of this kind; never change it once dashboards use it. */
  id: string;
  /** Shown in Management, e.g. "Device tile". */
  label: string;
  target: TargetType;
  sizes: readonly TileSize[];
  defaultSettings: TSettings;
  component: Type<unknown>;
  /**
   * The kind's own settings in Management's tile panel, below the target: a component with a `settings`
   * input (the tile's current settings) and a `changed` output that emits a patch of them.
   */
  settings?: Type<unknown>;
}

/** A self-contained extension of HomeyDash that registers one or more tile kinds. */
export interface TileModule {
  name: string;
  kinds: readonly TileKind[];
}

export const TILE_MODULES = new InjectionToken<readonly TileModule[]>('TILE_MODULES', {
  factory: () => [],
});

export function provideTileModules(...modules: TileModule[]): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: TILE_MODULES, useValue: modules }]);
}
