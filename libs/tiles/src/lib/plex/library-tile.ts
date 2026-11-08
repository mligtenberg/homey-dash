import { Segmented } from '../core/segmented';
import { PlexAirPlayControls } from './plex-airplay-controls';
import { PlexProfilePicker } from './plex-profile-picker';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LucideLibrary } from '@homey-dash/design-system';
import { LucideDynamicIcon } from '@lucide/angular';
import { TileDetails } from '../core/tile-details';
import { TILE_FACE_HOST } from '../core/tile-view';
import { PLEX_BROWSER_TEMPLATE, RecentlyAddedTile } from './recently-added-tile';

/**
 * A Plex library as a tile: its newest posters on the face, named with how many it holds, and a press opens everything in it
 * full screen, alphabetically a page at a time as it is scrolled: films, series or albums, never the episodes, seasons or
 * tracks under them. A tile for every library has a tab per library. A cover opens, drills down and plays as in the
 * recently-added tile, and so does the search.
 */
@Component({
  selector: 'hd-plex-library-tile',
  imports: [TileDetails, LucideDynamicIcon, PlexAirPlayControls, PlexProfilePicker, Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ...TILE_FACE_HOST, class: 'hd-tile hd-plex-recent', '[class.has-art]': 'shown().length > 0' },
  template: PLEX_BROWSER_TEMPLATE,
})
export class LibraryTile extends RecentlyAddedTile {
  protected override readonly browse = true;
  protected override readonly icon = LucideLibrary;
}
