import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { CORE_TILES, provideTileModules, RealtimeTileData, TileData } from '@homey-dash/tiles';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(),
    provideTileModules(CORE_TILES),
    { provide: TileData, useExisting: RealtimeTileData },
  ],
};
