import { TileModule } from '../tile-kind';
import { ENERGY_HOME } from './energy-data';
import { EnergyTile } from './energy-tile';

export * from './energy-data';
export * from './energy-tile';

// The energy tile kind (ADR-0014). Mirrored for assistants in apps/api/Mcp/ManagementTools.cs.

export const ENERGY_TILES: TileModule = {
  name: 'Energy',
  kinds: [
    {
      id: 'energy',
      label: 'Energy tile',
      // Always the energy report of its Homey (settings.account picks which).
      target: 'energy',
      // Small shows the grid power; wide and full add solar, home and the flow bar; large sizes add today.
      sizes: ['small', 'wide', 'full', 'large', 'full-large'],
      defaultSettings: { target: ENERGY_HOME },
      component: EnergyTile,
    },
  ],
};
