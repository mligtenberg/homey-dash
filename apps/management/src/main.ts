import { bootstrapApplication } from '@angular/platform-browser';
import { translatePage } from '@homey-dash/i18n';
import { installRipple } from '@homey-dash/design-system';
import { initManagementLocale } from './app/language';
import { appConfig } from './app/app.config';
import { App } from './app/app';

installRipple();
initManagementLocale();
bootstrapApplication(App, appConfig)
  .then((app) => translatePage(app.injector))
  .catch((err) => console.error(err));
