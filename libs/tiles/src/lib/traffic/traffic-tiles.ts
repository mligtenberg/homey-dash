import { TileModule } from '../tile-kind';
import { TrafficTileSettingsEditor } from './traffic-settings';
import { TrafficTile } from './traffic-tile';

export * from './traffic-data';
export * from './traffic-place-field';
export * from './traffic-route-field';
export * from './traffic-settings';
export * from './traffic-tile';

// The traffic tile kind (ADR-0014). Mirrored for assistants in apps/api/Mcp/ManagementTools.cs.

export const TRAFFIC_TILES: TileModule = {
  name: 'Traffic',
  kinds: [
    {
      id: 'traffic',
      label: 'Traffic tile',
      // Points at nothing in Homey: its route is in settings.route.
      target: 'none',
      // Small shows the time and delay; wide and full add the distance and arrival; large and full large the usual time.
      sizes: ['small', 'wide', 'full', 'large', 'full-large'],
      details: false,
      defaultSettings: { target: null },
      component: TrafficTile,
      settings: TrafficTileSettingsEditor,
    },
  ],
};
