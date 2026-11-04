import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PhotoSet, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { RealtimeTileData, TileData } from '@homey-dash/tiles';
import { PhotoSetPage } from './photo-set-page';

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

describe('PhotoSetPage', () => {
  async function render(sets: PhotoSet[], id = 's1') {
    const realtime = new FakeRealtime();
    realtime.photoSetList = sets;
    TestBed.configureTestingModule({
      imports: [PhotoSetPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Realtime, useValue: realtime },
        { provide: TileData, useExisting: RealtimeTileData },
      ],
    });
    const fixture = TestBed.createComponent(PhotoSetPage);
    fixture.componentRef.setInput('id', id);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the set with its photos', async () => {
    const page = await render([photoSet()]);

    expect((page.querySelector('[aria-label="Name of Summer"]') as HTMLInputElement).value).toBe('Summer');
    expect(page.textContent?.replace(/\s+/g, ' ')).toContain('1 photo from Summer');
    expect(page.querySelector('[aria-label="Photos"] img')?.getAttribute('src')).toBe('/api/photos/s1/p1');
  });

  it('lists the photos excluded from the set, with their thumbnails', async () => {
    const page = await render([photoSet({ excluded: ['x1', 'x2'] })]);

    const excluded = page.querySelector('[aria-label="Excluded from Summer"]');
    expect(excluded?.textContent).toContain('2 photos excluded on a display');
    expect([...(excluded?.querySelectorAll('img') ?? [])].map((img) => img.getAttribute('src'))).toEqual([
      '/api/photos/s1/x1',
      '/api/photos/s1/x2',
    ]);
  });

  it('brings an excluded photo back', async () => {
    const page = await render([photoSet({ excluded: ['x1'] })]);

    (page.querySelector('[aria-label="Bring back excluded photo 1"]') as HTMLButtonElement).click();

    const request = TestBed.inject(HttpTestingController).expectOne('/api/photo-sets/s1/excluded/x1');
    expect(request.request.method).toBe('DELETE');
    request.flush(photoSet());
  });

  it('says nothing about excluded photos when there are none', async () => {
    const page = await render([photoSet()]);

    expect(page.querySelector('[aria-label="Excluded from Summer"]')).toBeNull();
  });

  it('draws again in the background, polling the set until it is done', async () => {
    const page = await render([photoSet({ selection: { with: [], without: [], query: null, count: 10, refreshHours: 24 }, albumId: null })]);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      const http = TestBed.inject(HttpTestingController);
      const button = () => [...page.querySelectorAll('button')].find((b) => b.textContent?.includes('Draw'))!;

      button().click();
      http.expectOne({ method: 'POST', url: '/api/photo-sets/s1/sync' }).flush(photoSet({ syncing: true }), { status: 202, statusText: 'Accepted' });
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne('/api/photo-sets/s1').flush(photoSet({ syncing: true }));
      TestBed.tick();
      expect(button().textContent).toContain('Drawing…');
      expect(page.querySelector('[role="status"]')?.textContent).toContain('Drawing photos…');

      await vi.advanceTimersByTimeAsync(1000);
      http.expectOne('/api/photo-sets/s1').flush(photoSet());
      await vi.advanceTimersByTimeAsync(0);
      TestBed.tick();
      expect(button().textContent).toContain('Draw again');
      // Done, so polling stops.
      await vi.advanceTimersByTimeAsync(5000);
      http.expectNone('/api/photo-sets/s1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when the set no longer exists', async () => {
    const page = await render([photoSet()], 'gone');

    expect(page.textContent).toContain('This photo set no longer exists');
  });
});
