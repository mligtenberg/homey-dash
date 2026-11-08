import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  CORE_TILES,
  LOGIC_TILES,
  PLEX_TILES,
  TIME_TILES,
  WEATHER_TILES,
  SONOS_TILES,
  provideTileModules,
  RealtimeRuleAnswers,
  RealtimeTileData,
  RuleAnswers,
  TileData,
} from '@homey-dash/tiles';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideTileModules(CORE_TILES, PLEX_TILES, WEATHER_TILES, TIME_TILES, SONOS_TILES, LOGIC_TILES),
    { provide: TileData, useExisting: RealtimeTileData },
    { provide: RuleAnswers, useExisting: RealtimeRuleAnswers },
  ],
};
