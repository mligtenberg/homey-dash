import { computed, inject } from '@angular/core';
import { Realtime } from '@homey-dash/api-client';
import { TileView } from '../core/tile-view';
import { PlexData } from './plex-data';

/** What the tiles of one Plex account share: its data, the connection to ask more of it, and which account it is. */
export abstract class PlexTileView extends TileView {
  protected readonly plex = inject(PlexData);
  protected readonly realtime = inject(Realtime);

  protected readonly overview = computed(() => this.plex.overview(this.settings().account));
  /** The account's id, 0 until its overview has arrived. */
  protected readonly accountId = computed(() => this.overview()?.accountId ?? 0);
}
