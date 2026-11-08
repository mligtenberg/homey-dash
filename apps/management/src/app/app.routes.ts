import { Route } from '@angular/router';
import { DisplayPage } from './displays/display-page';
import { DisplaysPage } from './displays/displays-page';
import { HomePage } from './home-page';
import { Shell } from './shell';

export const appRoutes: Route[] = [
  // Preview fills the whole window, so it sits outside the shell with its sidebar.
  { path: 'dashboards/:id/preview', loadChildren: () => import('./preview.routes') },
  {
    path: '',
    component: Shell,
    children: [
      { path: '', component: HomePage, title: 'HomeyDash' },
      { path: 'dashboards/:id', loadChildren: () => import('./editor/editor.routes') },
      { path: 'displays', component: DisplaysPage, title: 'Displays · HomeyDash' },
      {
        path: 'displays/:id',
        component: DisplayPage,
        title: 'Display · HomeyDash',
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'details' },
          { path: 'details', loadComponent: () => import('./displays/display-details-tab').then((m) => m.DisplayDetailsTab) },
          { path: 'dashboards', loadComponent: () => import('./displays/display-dashboards-tab').then((m) => m.DisplayDashboardsTab) },
          { path: 'idle', loadComponent: () => import('./displays/display-idle-tab').then((m) => m.DisplayIdleTab) },
          { path: 'lock', loadComponent: () => import('./displays/display-lock-tab').then((m) => m.DisplayLockTab) },
        ],
      },
      // Visited rarely, so they load on first visit and keep the editor's bundle small.
      {
        path: 'photo-sets',
        loadComponent: () => import('./photo-sets-page').then((m) => m.PhotoSetsPage),
        title: 'Photo sets · HomeyDash',
      },
      {
        path: 'photo-sets/:id',
        loadComponent: () => import('./photo-set-page').then((m) => m.PhotoSetPage),
        title: 'Photo set · HomeyDash',
      },
      { path: 'accounts', loadComponent: () => import('./accounts-page').then((m) => m.AccountsPage), title: 'Accounts · HomeyDash' },
    ],
  },
  { path: '**', redirectTo: '' },
];
