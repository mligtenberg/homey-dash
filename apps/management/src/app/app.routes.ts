import { Route } from '@angular/router';
import { DisplaysPage } from './displays-page';
import { EditorPage } from './editor/editor-page';
import { HomePage } from './home-page';
import { PreviewPage } from './preview-page';
import { Shell } from './shell';

export const appRoutes: Route[] = [
  // Preview fills the whole window, so it sits outside the shell with its sidebar.
  { path: 'dashboards/:id/preview', component: PreviewPage, title: 'Preview · HomeyDash' },
  {
    path: '',
    component: Shell,
    children: [
      { path: '', component: HomePage, title: 'HomeyDash' },
      { path: 'dashboards/:id', component: EditorPage, title: 'Dashboard · HomeyDash' },
      { path: 'displays', component: DisplaysPage, title: 'Displays · HomeyDash' },
    ],
  },
  { path: '**', redirectTo: '' },
];
