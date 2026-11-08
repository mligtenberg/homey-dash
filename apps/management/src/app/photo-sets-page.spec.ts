import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PhotoSet, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { RealtimeTileData, TileData } from '@homey-dash/tiles';
import { PhotoSetsPage } from './photo-sets-page';

const photoSet = (change: Partial<PhotoSet> = {}): PhotoSet => ({
  id: 's1',
  name: 'Summer',
  target: 'photo-set:s1',
  accountId: 1,
  accountName: 'Immich',
  albumId: 'a1',
  albumName: 'Summer',
  selection: null,
  photos: [{ id: 'p1', takenAt: null, place: null, faces: null }],
  syncedAt: null,
  skippedVideos: 0,
  syncError: null,
  syncing: false,
  dashboards: [],
  excluded: [],
  lockedOwners: [],
  ...change,
});

describe('PhotoSetsPage', () => {
  async function render(sets: PhotoSet[]) {
    const realtime = new FakeRealtime();
    realtime.photoSetList = sets;
    TestBed.configureTestingModule({
      imports: [PhotoSetsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Realtime, useValue: realtime },
        { provide: TileData, useExisting: RealtimeTileData },
      ],
    });
    const fixture = TestBed.createComponent(PhotoSetsPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists each set as a link to its own page, with only an overview of it', async () => {
    const page = await render([
      photoSet({ excluded: ['x1'], dashboards: ['Hall'] }),
    ]);

    const link = page.querySelector('a.set');
    expect(link?.getAttribute('href')).toBe('/photo-sets/s1');
    expect(link?.textContent).toContain('Summer');
    expect(link?.textContent?.replace(/\s+/g, ' ')).toContain(
      '1 photo from Summer',
    );
    expect(link?.textContent).toContain('1 excluded');
    expect(link?.textContent).toContain('Shown on Hall');
    expect(page.querySelector('button')?.textContent).toContain(
      'New photo set',
    );
    expect(page.querySelectorAll('button')).toHaveLength(1);
  });

  it('says when a set failed to sync', async () => {
    const page = await render([
      photoSet({ syncError: 'Immich is out of reach.' }),
    ]);

    expect(page.querySelector('a.set .failed')?.textContent).toContain(
      'Syncing failed',
    );
  });
});
