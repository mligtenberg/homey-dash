import { bootstrapApplication } from '@angular/platform-browser';
import { installRipple } from '@homey-dash/design-system';
import { browserLocale, setLocale, translatePage } from '@homey-dash/i18n';
import { appConfig } from './app/app.config';
import { App } from './app/app';

installRipple();
setLocale(browserLocale());
bootstrapApplication(App, appConfig)
  .then((app) => translatePage(app.injector))
  .catch((err) => console.error(err));
