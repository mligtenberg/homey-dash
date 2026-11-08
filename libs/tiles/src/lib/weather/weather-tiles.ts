import { WEATHER_HERE } from '@homey-dash/api-client';
import { TileModule } from '../tile-kind';
import { WeatherTileSettingsEditor } from './weather-settings';
import { WeatherTile } from './weather-tile';

export * from './weather-data';
export * from './weather-settings';
export * from './weather-tile';

// The weather tile kind (ADR-0013). Mirrored for assistants in apps/api/Mcp/ManagementTools.cs.

export const WEATHER_TILES: TileModule = {
  name: 'Weather',
  kinds: [
    {
      id: 'weather',
      label: 'Weather tile',
      // Where its Homey is (weather:here), or a place of its own in settings.place (weather:place).
      target: 'weather',
      // Small shows now; wide and full add the coming hours; large and full large the coming days and the rain.
      sizes: ['small', 'wide', 'full', 'large', 'full-large'],
      defaultSettings: { target: WEATHER_HERE },
      component: WeatherTile,
      settings: WeatherTileSettingsEditor,
    },
  ],
};
