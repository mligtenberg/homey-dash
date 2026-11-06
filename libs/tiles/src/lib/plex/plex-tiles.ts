import { ALL_PLEX_LIBRARIES, ANY_PLEX_PLAYER } from '@homey-dash/api-client';
import { TileModule } from '../tile-kind';
import { NowPlayingTile } from './now-playing-tile';
import { LibraryTile } from './library-tile';
import { RecentlyAddedTile } from './recently-added-tile';

export * from './library-tile';
export * from './now-playing-tile';
export * from './plex-data';
export * from './recently-added-tile';

// The Plex tile kinds (ADR-0009). Mirrored for assistants in apps/api/Mcp/ManagementTools.cs.

export const PLEX_TILES: TileModule = {
  name: 'Plex',
  kinds: [
    {
      id: 'plex-now-playing',
      label: 'Plex now playing tile',
      target: 'plexPlayer',
      // Small has room for the play button alone; the wider sizes add skipping and time.
      sizes: ['small', 'wide', 'full', 'large', 'full-large'],
      defaultSettings: { target: ANY_PLEX_PLAYER },
      component: NowPlayingTile,
    },
    {
      id: 'plex-recent',
      label: 'Plex recently added tile',
      target: 'plexLibrary',
      sizes: ['small', 'wide', 'full', 'large', 'full-large'],
      defaultSettings: { target: ALL_PLEX_LIBRARIES },
      component: RecentlyAddedTile,
    },
    {
      id: 'plex-library',
      label: 'Plex library tile',
      target: 'plexLibrary',
      sizes: ['small', 'wide', 'full', 'large', 'full-large'],
      defaultSettings: { target: ALL_PLEX_LIBRARIES },
      component: LibraryTile,
    },
  ],
};
