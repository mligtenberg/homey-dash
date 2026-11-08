import { Route } from '@angular/router';
import { tileProviders } from './tile-providers';

export default [
  {
    path: '',
    providers: tileProviders,
    title: 'Preview · HomeyDash',
    loadComponent: () => import('./preview-page').then((m) => m.PreviewPage),
  },
] satisfies Route[];
