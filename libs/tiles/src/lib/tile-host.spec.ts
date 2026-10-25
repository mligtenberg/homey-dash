import { TestBed } from '@angular/core/testing';
import { Tile } from '@homey-dash/api-client';
import { CORE_TILES } from './core/core-tiles';
import { provideTileModules } from './tile-kind';
import { TileHost } from './tile-host';

describe('TileHost', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideTileModules(CORE_TILES)] }));

  function render(tile: Partial<Tile>) {
    const fixture = TestBed.createComponent(TileHost);
    fixture.componentRef.setInput('tile', { id: 't1', kind: 'nope', size: 'wide', position: { column: 1, row: 2 }, settings: {}, ...tile });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('places the tile on its grid cell', () => {
    const host = render({});

    expect(host.style.gridColumn).toBe('2 / span 2');
    expect(host.style.gridRow).toBe('3 / span 1');
  });

  it('says so when no module registers the kind', () => {
    expect(render({ kind: 'removed.kind' }).textContent).toContain('Kind "removed.kind" is not installed');
  });
});
