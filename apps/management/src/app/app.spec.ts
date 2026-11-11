import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { DashboardSummary, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { TileData, RealtimeTileData } from '@homey-dash/tiles';
import { Shell } from './shell';

const dashboard = (id: string, name: string, change: Partial<DashboardSummary> = {}): DashboardSummary => ({
  id,
  name,
  publishedVersion: 1,
  publishedAt: null,
  hasUnpublishedChanges: false,
  missingTiles: 0,
  ...change,
});

@Component({ template: '' })
class Blank {}

describe('Shell', () => {
  let realtime: FakeRealtime;

  async function render(list: DashboardSummary[]) {
    realtime = new FakeRealtime();
    TestBed.configureTestingModule({
      imports: [Shell],
      providers: [provideRouter([{ path: '**', component: Blank }]), provideHttpClient(), provideHttpClientTesting(), { provide: Realtime, useValue: realtime }, { provide: TileData, useExisting: RealtimeTileData }],
    });
    const fixture = TestBed.createComponent(Shell);
    // The sidebar lists a place's items while you are in it.
    await TestBed.inject(Router).navigateByUrl('/dashboards');
    await fixture.whenStable();
    TestBed.inject(HttpTestingController).match('/api/dashboards').forEach((request) => request.flush(list));
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const items = (root: HTMLElement) => [...root.querySelectorAll('.items a.item[href^="/dashboards/"]')];

  it('lists dashboards and marks one with unpublished changes', async () => {
    const root = await render([
      dashboard('1', 'Hallway', { publishedVersion: 2 }),
      dashboard('2', 'Kitchen', { publishedVersion: 0, hasUnpublishedChanges: true }),
    ]);

    expect(items(root).map((i) => i.querySelector('.item__name')?.textContent)).toEqual(['Hallway', 'Kitchen']);
    expect(items(root).map((i) => i.querySelector('.draft')?.getAttribute('aria-label') ?? null)).toEqual([null, 'Unpublished changes']);
  });

  it('flags a dashboard with tiles Homey does not have', async () => {
    const root = await render([dashboard('1', 'Hallway'), dashboard('2', 'Kitchen', { missingTiles: 2 })]);

    expect(items(root).map((i) => i.querySelector('.attn')?.getAttribute('aria-label') ?? null)).toEqual([
      null,
      '2 tiles not found in Homey',
    ]);
  });

  it('follows dashboards changed elsewhere', async () => {
    const root = await render([dashboard('1', 'Hallway')]);

    realtime.push('Dashboards', [dashboard('1', 'Hallway'), dashboard('2', 'Attic')]);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(items(root).map((i) => i.querySelector('.item__name')?.textContent)).toEqual(['Hallway', 'Attic']);
  });
});
