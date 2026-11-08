import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RealtimeRuleAnswers, RealtimeTileData, RuleAnswers, TileData } from '@homey-dash/tiles/data';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(),
    { provide: TileData, useExisting: RealtimeTileData },
    // The Editor and Preview see rules as on the display picked with AsDisplayPicker.
    { provide: RuleAnswers, useExisting: RealtimeRuleAnswers },
  ],
};
