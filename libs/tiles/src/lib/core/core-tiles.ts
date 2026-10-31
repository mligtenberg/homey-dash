import { TileSettings } from '../tile-data';
import { TileModule } from '../tile-kind';
import { FlowTile, MoodTile } from './action-tiles';
import { DeviceTile, DeviceTileSettingsEditor } from './device-tile';
import { MoodListTile } from './mood-list-tile';
import { PhotoTile, PhotoTileSettingsEditor } from './photo-tile';
import { StatisticTile, StatisticTileSettingsEditor } from './statistic-tile';

export * from './action-tiles';
export * from './device-tile';
export * from './mood-list-tile';
export * from './photo-tile';
export * from './statistic-tile';

// The tile kinds HomeyDash ships with.

const empty: TileSettings = { target: null };

export const CORE_TILES: TileModule = {
  name: 'Core',
  kinds: [
    {
      id: 'device',
      label: 'Device tile',
      target: 'device',
      sizes: ['small', 'wide', 'large'],
      defaultSettings: empty,
      component: DeviceTile,
      settings: DeviceTileSettingsEditor,
    },
    {
      id: 'flow',
      label: 'Flow tile',
      target: 'flow',
      // The play button is all there is to it.
      details: false,
      sizes: ['small', 'wide'],
      defaultSettings: empty,
      component: FlowTile,
    },
    {
      id: 'mood',
      label: 'Mood tile',
      target: 'mood',
      // The play button is all there is to it.
      details: false,
      sizes: ['small', 'wide'],
      defaultSettings: empty,
      component: MoodTile,
    },
    {
      id: 'mood-list',
      label: 'Mood list tile',
      target: 'mood',
      multiple: true,
      details: false,
      // A row of mood buttons needs at least two cells across.
      sizes: ['wide', 'full', 'large', 'full-large'],
      defaultSettings: { target: null, targets: [] },
      component: MoodListTile,
    },
    {
      id: 'statistic',
      label: 'Statistic tile',
      target: 'insight',
      // A single value fits a device tile better than a chart below these.
      sizes: ['large', 'full-large'],
      defaultSettings: empty,
      component: StatisticTile,
      settings: StatisticTileSettingsEditor,
    },
    {
      id: 'photo',
      label: 'Photo tile',
      target: 'photoSet',
      // A photo fills any cell; a Full large tile makes a photo frame on a wall tablet.
      sizes: ['small', 'wide', 'full', 'large', 'full-large'],
      defaultSettings: empty,
      component: PhotoTile,
      settings: PhotoTileSettingsEditor,
    },
  ],
};
