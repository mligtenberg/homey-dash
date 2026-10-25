import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Shell } from './shell';

describe('Shell', () => {
  it('lists dashboards and marks one with unpublished changes', async () => {
    TestBed.configureTestingModule({
      imports: [Shell],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(Shell);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/dashboards')
      .flush([
        { id: '1', name: 'Hallway', publishedVersion: 2, publishedAt: null, hasUnpublishedChanges: false },
        { id: '2', name: 'Kitchen', publishedVersion: 0, publishedAt: null, hasUnpublishedChanges: true },
      ]);
    await fixture.whenStable();

    const items = [...(fixture.nativeElement as HTMLElement).querySelectorAll('a.hd-nav__item')];
    expect(items.map((i) => i.querySelector('span')?.textContent)).toEqual(['Hallway', 'Kitchen']);
    expect(items.map((i) => i.querySelector('.hd-pill')?.textContent ?? null)).toEqual([null, 'Draft']);
  });
});
