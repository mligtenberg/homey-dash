import {
  CORE_TILES,
  ENERGY_TILES,
  LOGIC_TILES,
  PLEX_TILES,
  provideTileModules,
  SONOS_TILES,
  TileKindRegistry,
  TIME_TILES,
  TRAFFIC_TILES,
  WEATHER_TILES,
} from '@homey-dash/tiles';

/**
 * The tile kinds, with every tile component behind them. Only the routes that render tiles provide them,
 * so they load with those routes instead of in the initial bundle.
 *
 * The registry is provided here too: it is providedIn root, so it would otherwise read the modules from
 * the root injector, where there are none.
 */
export const tileProviders = [
  provideTileModules(CORE_TILES, PLEX_TILES, WEATHER_TILES, TRAFFIC_TILES, TIME_TILES, ENERGY_TILES, SONOS_TILES, LOGIC_TILES),
  TileKindRegistry,
];
