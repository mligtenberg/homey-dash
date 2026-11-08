import { Route } from '@angular/router';
import { tileProviders } from '../tile-providers';

export default [
  {
    path: '',
    providers: tileProviders,
    title: 'Dashboard · HomeyDash',
    loadComponent: () => import('./editor-page').then((m) => m.EditorPage),
  },
] satisfies Route[];
