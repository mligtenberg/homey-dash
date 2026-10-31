import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Realtime, Tile } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { CORE_TILES } from './core/core-tiles';
import { RealtimeTileData } from './realtime-tile-data';
import { TileData } from './tile-data';
import { provideTileModules } from './tile-kind';
import { TileHost } from './tile-host';

describe('TileHost', () => {
  let realtime: FakeRealtime;

  beforeEach(() => {
    realtime = new FakeRealtime();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTileModules(CORE_TILES),
        { provide: Realtime, useValue: realtime },
        { provide: TileData, useExisting: RealtimeTileData },
      ],
    });
  });

  function render(tile: Partial<Tile>) {
    const fixture = TestBed.createComponent(TileHost);
    fixture.componentRef.setInput('tile', { id: 't1', kind: 'nope', size: 'wide', position: { column: 1, row: 2 }, settings: {}, ...tile });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it("is lost while HomeyDash can't reach the Homey of a Homey tile", async () => {
    TestBed.inject(TileData);
    await TestBed.inject(ApplicationRef).whenStable();
    const host = render({ kind: 'device', settings: { target: 'd1' } });

    realtime.push('HomeyStatus', { accountId: 1, connection: 'disconnected', lastError: null, since: '', fake: false });
    await TestBed.inject(ApplicationRef).whenStable();

    expect(host.classList).toContain('is-homey-lost');
  });

  it('places the tile on its grid cell', () => {
    const host = render({});

    expect(host.style.gridColumn).toBe('2 / span 2');
    expect(host.style.gridRow).toBe('3 / span 1');
  });

  it('says so when no module registers the kind', () => {
    expect(render({ kind: 'removed.kind' }).textContent).toContain('Kind "removed.kind" is not installed');
  });
});
