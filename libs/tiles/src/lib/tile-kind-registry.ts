import { inject, Injectable } from '@angular/core';
import { TileSize } from '@homey-dash/layout';
import { TILE_MODULES, TileKind } from './tile-kind';

@Injectable({ providedIn: 'root' })
export class TileKindRegistry {
  private readonly kinds = new Map<string, TileKind>();

  constructor() {
    for (const module of inject(TILE_MODULES)) {
      for (const kind of module.kinds) {
        if (this.kinds.has(kind.id)) {
          throw new Error(`Tile kind "${kind.id}" from module "${module.name}" is already registered`);
        }
        this.kinds.set(kind.id, kind);
      }
    }
  }

  all(): TileKind[] {
    return [...this.kinds.values()];
  }

  /** Undefined when no module registers the kind, for example after a module was removed. */
  find(id: string): TileKind | undefined {
    return this.kinds.get(id);
  }

  supports(id: string, size: TileSize): boolean {
    return this.kinds.get(id)?.sizes.includes(size) ?? false;
  }
}
