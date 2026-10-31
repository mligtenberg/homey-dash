import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { CORE_TILES, PLEX_TILES, provideTileModules, RealtimeTileData, TileData } from '@homey-dash/tiles';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideTileModules(CORE_TILES, PLEX_TILES),
    { provide: TileData, useExisting: RealtimeTileData },
  ],
};
