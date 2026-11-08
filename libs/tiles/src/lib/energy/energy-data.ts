import { EnergyLive, EnergyPoint, HomeyEnergy } from '@homey-dash/api-client';
import { TileSettings } from '../tile-data';

/** What an energy tile points at: the energy report of its Homey (ADR-0014). */
export const ENERGY_HOME = 'energy:home';

/** An energy tile's settings: the Homey comes from `account`, as for any Homey tile. */
export type EnergyTileSettings = TileSettings;

/** Below this many watts the grid counts as balanced: meters flicker around zero. */
export const BALANCED_WATTS = 10;

/** 640 W below a kilowatt, 1.8 kW above. */
export function formatPower(watts: number): string {
  const abs = Math.abs(watts);
  return abs < 1000 ? `${Math.round(abs)} W` : `${(abs / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kW`;
}

/** 10.9 kWh. */
export function formatEnergy(kwh: number): string {
  return `${kwh.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`;
}

/** € 2.98, or 2.98 where Homey tells no currency. */
export function formatCost(cost: number, currency: string | null): string {
  if (!currency) return cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try {
    return cost.toLocaleString(undefined, { style: 'currency', currency });
  } catch {
    return `${currency} ${cost.toFixed(2)}`;
  }
}

/** What the grid does, as the full view says it: `Importing from the grid`. */
export function gridSentence(flow: GridFlow): string {
  return flow === 'import' ? 'Importing from the grid' : flow === 'export' ? 'Exporting to the grid' : 'Balanced with the grid';
}

export type GridFlow = 'import' | 'export' | 'balanced';

/** Whether the home takes from the grid, gives to it, or neither. */
export function gridFlow(grid: number | null): GridFlow | null {
  return grid === null ? null : Math.abs(grid) < BALANCED_WATTS ? 'balanced' : grid > 0 ? 'import' : 'export';
}

/** The words for a flow of power: `Importing`. */
export function gridWord(flow: GridFlow): string {
  return flow === 'import' ? 'Importing' : flow === 'export' ? 'Exporting' : 'Balanced';
}

/** The segments of the flow bar, as fractions of the whole: what the sun fills of the home, what the grid adds, what goes back. */
export interface FlowSegments {
  solar: number;
  grid: number;
  export: number;
}

/** Where the power of the home comes from and goes to; null while there is none to show. */
export function flowSegments(live: EnergyLive | null): FlowSegments | null {
  if (!live) return null;
  const solar = Math.max(0, live.solar ?? 0);
  const grid = live.grid ?? (live.home === null ? 0 : live.home - solar);
  const usedSolar = live.home === null ? solar : Math.min(solar, live.home);
  const imported = Math.max(0, grid);
  const exported = Math.max(0, -grid);
  const total = usedSolar + imported + exported;
  return total <= 0 ? null : { solar: usedSolar / total, grid: imported / total, export: exported / total };
}

/** One bar of the day chart: the hour it is for (0–23) and the energy of the hour, in kWh. */
export interface HourBar {
  hour: number;
  home: number;
  solar: number;
}

/** Today by the hour, one bar for each, from a report's points (by the display's own clock). */
export function hourBars(history: readonly EnergyPoint[]): HourBar[] {
  const hours = new Map<number, HourBar>();
  for (const point of history) {
    const hour = new Date(point.t).getHours();
    const bar = hours.get(hour) ?? { hour, home: 0, solar: 0 };
    bar.home += point.home ?? 0;
    bar.solar += point.solar ?? 0;
    hours.set(hour, bar);
  }
  return [...hours.values()].sort((a, b) => a.hour - b.hour);
}

/** What a tile says while there is no live power, from the report: why, or `…` while it is still on its way. */
export function energyIdle(energy: HomeyEnergy | null | undefined, homeyFound: boolean, lost: boolean): string {
  if (!homeyFound) return 'Homey not found';
  if (energy?.status === 'unavailable') return 'Energy is not shared by Homey';
  if (lost && !energy) return 'Cannot reach Homey';
  return '…';
}
