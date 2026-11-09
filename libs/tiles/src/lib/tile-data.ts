import { Signal } from '@angular/core';
import {
  HomeyDevice,
  HomeyEnergy,
  HomeyFlow,
  HomeyFlowFolder,
  HomeyInsightLog,
  HomeyMood,
  HomeyStatus,
  HomeyUser,
  HomeyWeather,
  HomeyZone,
  PhotoSet,
} from '@homey-dash/api-client';

/** What tiles read from the Homey of one account. A target that is not in its map is missing (or not loaded yet). */
export interface HomeyData {
  accountId: number;
  /** The account's name, telling a home's Homeys apart. */
  accountName: string;
  /** HomeyDash's connection to this Homey. */
  status: HomeyStatus;
  /** False until the Homey's data first arrived. */
  loaded: boolean;
  devices: ReadonlyMap<string, HomeyDevice>;
  flows: ReadonlyMap<string, HomeyFlow>;
  moods: ReadonlyMap<string, HomeyMood>;
  /** Empty until they once loaded, which needs the Homey to be reachable. */
  insights: ReadonlyMap<string, HomeyInsightLog>;
  zones: ReadonlyMap<string, HomeyZone>;
  flowFolders: ReadonlyMap<string, HomeyFlowFolder>;
  /** The people of this Homey, home or away and asleep or awake. */
  users: ReadonlyMap<string, HomeyUser>;
  /** The weather where this Homey is; null until Homey first told it, or when Homey won't. */
  weather: HomeyWeather | null;
  /** Homey's energy report; null until HomeyDash first asked Homey for it. */
  energy: HomeyEnergy | null;
}

/**
 * What tiles read from each Homey and HomeyDash's photo sets, filled from HomeyDash's realtime connection. A Homey tile
 * reads the Homey of its account (`settings.account`), or of the oldest when it names none.
 */
export abstract class TileData {
  /** Every Homey, oldest account first; null until they first arrived. */
  abstract readonly homeys: Signal<readonly HomeyData[] | null>;
  /** Photo sets by their target, `photo-set:<id>`. */
  abstract readonly photoSets: Signal<ReadonlyMap<string, PhotoSet>>;
  abstract readonly photoSetsLoaded: Signal<boolean>;

  /** The Homey of a tile's account, or the oldest when it names none; undefined when there is no such Homey. */
  homey(account?: number): HomeyData | undefined {
    const homeys = this.homeys() ?? [];
    return account === undefined ? homeys[0] : homeys.find((h) => h.accountId === account);
  }

  /**
   * Whether tiles of an account can't reach their Homey: HomeyDash lost its connection to it, or no Homey is set up at
   * all. A tile naming a removed account is missing instead.
   */
  homeyLost(account?: number): boolean {
    if (!this.homeys()) return false;
    const homey = this.homey(account);
    return homey ? homey.status.connection === 'disconnected' : account === undefined;
  }
}

/** Settings every tile kind shares; a kind adds its own on top. */
export interface TileSettings {
  /** The id of the tile's target (in Homey, or a photo set's target), or null until one is picked. */
  target: string | null;
  /** The ids of the tile's targets, in order, for a kind that takes several (see `TileKind.multiple`). */
  targets?: string[];
  /** Overrides the target's name on the tile. */
  label?: string;
  /** The account the target is in, for kinds whose service a home can have several accounts of; absent for the oldest. */
  account?: number;
}
