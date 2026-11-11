import { TileModule } from '../tile-kind';
import { ClockTile } from './clock-tile';
import { DateTile } from './date-tile';
import { TimerTile } from './timer-tile';
import { ClockTileSettingsEditor, DateTileSettingsEditor } from './time-settings';

export * from './clock-tile';
export * from './date-tile';
export * from './time-data';
export * from './time-settings';
export * from './timer-tile';
export * from './timers';
export * from './timer-panel';

// The clock and date tile kinds. Mirrored for assistants in apps/api/Mcp/ManagementTools.cs.

export const TIME_TILES: TileModule = {
  name: 'Time',
  kinds: [
    {
      id: 'clock',
      label: 'Clock tile',
      // The time is the display's own, so there is nothing to point at.
      target: 'none',
      sizes: ['small', 'wide', 'full', 'large', 'full-large'],
      defaultSettings: { target: null },
      component: ClockTile,
      settings: ClockTileSettingsEditor,
    },
    {
      id: 'date',
      label: 'Date tile',
      target: 'none',
      // Small and wide show today; large and full large show the month.
      sizes: ['small', 'wide', 'full', 'large', 'full-large'],
      defaultSettings: { target: null },
      component: DateTile,
      settings: DateTileSettingsEditor,
    },
    {
      id: 'timer',
      label: 'Timer tile',
      target: 'none',
      // Buttons start timers, so it needs room beside the list.
      sizes: ['wide', 'full', 'large', 'full-large'],
      defaultSettings: { target: null },
      component: TimerTile,
    },
  ],
};
