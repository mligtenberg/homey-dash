import { TileSettings } from '../tile-data';
import { TileModule } from '../tile-kind';
import { FlowTile, MoodTile } from './action-tiles';
import { DeviceTile, DeviceTileSettingsEditor } from './device-tile';
import { StatisticTile, StatisticTileSettingsEditor } from './statistic-tile';

export * from './action-tiles';
export * from './device-tile';
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
    { id: 'flow', label: 'Flow tile', target: 'flow', sizes: ['small', 'wide'], defaultSettings: empty, component: FlowTile },
    { id: 'mood', label: 'Mood tile', target: 'mood', sizes: ['small', 'wide'], defaultSettings: empty, component: MoodTile },
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
  ],
};
