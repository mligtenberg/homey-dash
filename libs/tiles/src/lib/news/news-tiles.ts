import { TileModule } from '../tile-kind';
import { NewsTileSettingsEditor } from './news-settings';
import { NewsTile } from './news-tile';

export * from './news-data';
export * from './news-settings';
export * from './news-tile';

// The news tile kind (ADR-0016). Mirrored for assistants in apps/api/Mcp/ManagementTools.cs.

export const NEWS_TILES: TileModule = {
  name: 'News',
  kinds: [
    {
      id: 'news',
      label: 'News tile',
      // Points at nothing in Homey: its feed is in settings.source.
      target: 'none',
      // The newest headline on small and wide; two on full, three on large, six on full large. A press opens all of them.
      sizes: ['small', 'wide', 'full', 'large', 'full-large'],
      defaultSettings: { target: null },
      component: NewsTile,
      settings: NewsTileSettingsEditor,
    },
  ],
};
