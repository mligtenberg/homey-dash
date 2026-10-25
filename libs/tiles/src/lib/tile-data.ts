import { Signal } from '@angular/core';
import { HomeyDevice, HomeyFlow, HomeyInsightLog, HomeyMood } from '@homey-dash/api-client';

/**
 * What tiles read from Homey. Management fills it over REST; displays fill it from HomeyDash's
 * realtime connection. A target that is not in its map is missing (or not loaded yet, see `loaded`).
 */
export abstract class TileData {
  abstract readonly loaded: Signal<boolean>;
  abstract readonly devices: Signal<ReadonlyMap<string, HomeyDevice>>;
  abstract readonly flows: Signal<ReadonlyMap<string, HomeyFlow>>;
  abstract readonly moods: Signal<ReadonlyMap<string, HomeyMood>>;
  abstract readonly insights: Signal<ReadonlyMap<string, HomeyInsightLog>>;
}

/** Settings every tile kind shares; a kind adds its own on top. */
export interface TileSettings {
  /** The id of the tile's target in Homey, or null until one is picked. */
  target: string | null;
  /** Overrides the target's name on the tile. */
  label?: string;
}
