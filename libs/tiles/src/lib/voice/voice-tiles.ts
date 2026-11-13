import { TileModule } from '../tile-kind';
import { VoiceMemoTile } from './voice-memo-tile';

export * from './memo-data';
export * from './voice-memo-panel';
export * from './voice-memo-tile';

// The voice memo tile kind. Mirrored for assistants in apps/api/Mcp/ManagementTools.cs.

export const VOICE_TILES: TileModule = {
  name: 'Voice',
  kinds: [
    {
      id: 'voice-memo',
      label: 'Voice memo tile',
      target: 'none',
      // The record button and the newest memo need room side by side.
      sizes: ['wide', 'full', 'large', 'full-large'],
      defaultSettings: { target: null },
      component: VoiceMemoTile,
    },
  ],
};
