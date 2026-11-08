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

/**
 * What a tile kind points at: something in Homey, a photo set, a Plex player or library, or the weather where a Homey is;
 * or nothing itself, as a logic tile, whose tiles each have their own.
 */
export type TargetType = 'device' | 'flow' | 'mood' | 'insight' | 'photoSet' | 'plexPlayer' | 'plexLibrary' | 'weather' | 'energy' | 'none';

/** Whether a kind's target is something in Homey, read from the Homey of the tile's account. */
export function isHomeyTarget(target: TargetType) {
  return target === 'device' || target === 'flow' || target === 'mood' || target === 'insight';
}

/** Whether a kind's tiles name a Homey account in `settings.account`: those in Homey, and the weather where a Homey is. */
export function usesHomeyAccount(target: TargetType) {
  return isHomeyTarget(target) || target === 'weather' || target === 'energy';
}

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
  /** The tile points at several targets of its type, in `settings.targets`, instead of one in `settings.target`. */
  multiple?: boolean;
  /**
   * False for a kind whose tiles never open a detail view on a press, such as one that is all buttons.
   * Otherwise a press opens the view where the tile offers one.
   */
  details?: boolean;
  /** For a device kind: Management only offers devices that have this capability, such as `sonos_group`. */
  requiresCapability?: string;
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
