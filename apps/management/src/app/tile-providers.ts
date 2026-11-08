import {
  CORE_TILES,
  ENERGY_TILES,
  LOGIC_TILES,
  PLEX_TILES,
  provideTileModules,
  SONOS_TILES,
  TIME_TILES,
  TRAFFIC_TILES,
  WEATHER_TILES,
} from '@homey-dash/tiles';

/**
 * The tile kinds, with every tile component behind them. Only the routes that render tiles provide them,
 * so they load with those routes instead of in the initial bundle.
 */
export const tileProviders = [
  provideTileModules(
    CORE_TILES,
    PLEX_TILES,
    WEATHER_TILES,
    TRAFFIC_TILES,
    TIME_TILES,
    ENERGY_TILES,
    SONOS_TILES,
    LOGIC_TILES,
  ),
];
