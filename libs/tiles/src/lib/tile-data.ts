import { Signal } from '@angular/core';
import { HomeyDevice, HomeyFlow, HomeyFlowFolder, HomeyInsightLog, HomeyMood, HomeyZone, PhotoSet } from '@homey-dash/api-client';

/**
 * What tiles read from Homey and HomeyDash's photo sets, filled from HomeyDash's realtime connection. A target that is
 * not in its map is missing (or not loaded yet, see `loaded` and `photoSetsLoaded`).
 */
export abstract class TileData {
  abstract readonly loaded: Signal<boolean>;
  abstract readonly devices: Signal<ReadonlyMap<string, HomeyDevice>>;
  abstract readonly flows: Signal<ReadonlyMap<string, HomeyFlow>>;
  abstract readonly moods: Signal<ReadonlyMap<string, HomeyMood>>;
  abstract readonly insights: Signal<ReadonlyMap<string, HomeyInsightLog>>;
  abstract readonly zones: Signal<ReadonlyMap<string, HomeyZone>>;
  abstract readonly flowFolders: Signal<ReadonlyMap<string, HomeyFlowFolder>>;
  /** Photo sets by their target, `photo-set:<id>`. */
  abstract readonly photoSets: Signal<ReadonlyMap<string, PhotoSet>>;
  abstract readonly photoSetsLoaded: Signal<boolean>;
}

/** Settings every tile kind shares; a kind adds its own on top. */
export interface TileSettings {
  /** The id of the tile's target (in Homey, or a photo set's target), or null until one is picked. */
  target: string | null;
  /** The ids of the tile's targets, in order, for a kind that takes several (see `TileKind.multiple`). */
  targets?: string[];
  /** Overrides the target's name on the tile. */
  label?: string;
}
