import { TileModule } from '../tile-kind';
import { SonosTile } from './sonos-tile';

export * from './sonos-tile';

// The Sonos tile kind: multiroom control through the speakers' Homey devices. Mirrored for assistants in apps/api/Mcp/ManagementTools.cs.

export const SONOS_TILES: TileModule = {
  name: 'Sonos',
  kinds: [
    {
      id: 'sonos',
      label: 'Sonos tile',
      target: 'device',
      multiple: true,
      // Only Sonos speakers have a group.
      requiresCapability: 'sonos_group',
      // Every size shows the lead room's music; a press opens every room, and a full tall tile lists them on the tile.
      sizes: ['small', 'wide', 'full', 'large', 'full-large', 'full-tall'],
      defaultSettings: { target: null, targets: [] },
      component: SonosTile,
    },
  ],
};
