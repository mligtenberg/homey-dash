import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import {
  CORE_TILES,
  LOGIC_TILES,
  PLEX_TILES,
  WEATHER_TILES,
  SONOS_TILES,
  provideTileModules,
  RealtimeRuleAnswers,
  RealtimeTileData,
  RuleAnswers,
  TileData,
} from '@homey-dash/tiles';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(),
    provideTileModules(CORE_TILES, PLEX_TILES, WEATHER_TILES, SONOS_TILES, LOGIC_TILES),
    { provide: TileData, useExisting: RealtimeTileData },
    // The Editor and Preview see rules as on the display picked with AsDisplayPicker.
    { provide: RuleAnswers, useExisting: RealtimeRuleAnswers },
  ],
};
