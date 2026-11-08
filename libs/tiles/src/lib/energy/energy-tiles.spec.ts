import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HomeyEnergy, HomeySnapshot, Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { TileSize } from '@homey-dash/layout';
import { RealtimeTileData } from '../realtime-tile-data';
import { TileData } from '../tile-data';
import { ENERGY_HOME, flowSegments, formatEnergy, formatPower, gridFlow, hourBars } from './energy-data';
import { EnergyTile } from './energy-tile';
import { ENERGY_TILES } from './energy-tiles';

const energy = (change: Partial<HomeyEnergy> = {}): HomeyEnergy => ({
  status: 'ok',
  live: { grid: -650, solar: 1830, home: 1180 },
  day: {
    imported: 4.2,
    exported: 3.1,
    solar: 9.8,
    home: 10.9,
    history: Array.from({ length: 6 }, (_, h) => ({ t: new Date(2026, 10, 8, h).toISOString(), home: 0.4, solar: h > 3 ? 0.8 : 0 })),
  },
  ...change,
});

describe('Energy helpers', () => {
  it('writes power in watts below a kilowatt and kilowatts above', () => {
    expect(formatPower(640)).toBe('640 W');
    expect(formatPower(-1830)).toBe('1.8 kW');
    expect(formatEnergy(10.94)).toBe('10.9 kWh');
  });

  it('tells importing, exporting and balanced apart', () => {
    expect([gridFlow(630), gridFlow(-650), gridFlow(4), gridFlow(null)]).toEqual(['import', 'export', 'balanced', null]);
  });

  it('splits the flow bar between what the sun fills, what the grid adds and what goes back', () => {
    expect(flowSegments({ grid: -800, solar: 1800, home: 1000 })).toEqual({ solar: 1000 / 1800, grid: 0, export: 800 / 1800 });
    expect(flowSegments({ grid: 500, solar: 500, home: 1000 })).toEqual({ solar: 0.5, grid: 0.5, export: 0 });
    expect(flowSegments({ grid: 0, solar: 0, home: 0 })).toBeNull();
    expect(flowSegments(null)).toBeNull();
  });

  it('sums points into hours', () => {
    const bars = hourBars([
      { t: new Date(2026, 10, 8, 1, 0).toISOString(), home: 0.1, solar: null },
      { t: new Date(2026, 10, 8, 1, 30).toISOString(), home: 0.2, solar: 0.1 },
    ]);
    expect(bars).toHaveLength(1);
    expect(bars[0].hour).toBe(1);
    expect(bars[0].home).toBeCloseTo(0.3);
    expect(bars[0].solar).toBeCloseTo(0.1);
  });
});

// jsdom has no modal dialogs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

describe('Energy tile', () => {
  let realtime: FakeRealtime;

  beforeEach(() => {
    realtime = new FakeRealtime();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Realtime, useValue: realtime },
        { provide: TileData, useExisting: RealtimeTileData },
      ],
    });
  });

  const settle = () => TestBed.inject(ApplicationRef).whenStable();

  async function render(report: HomeyEnergy | null, size: TileSize = 'wide', settings: Record<string, unknown> = { target: ENERGY_HOME }) {
    realtime.homeySnapshot = realtime.homeySnapshot.map((s: HomeySnapshot) => ({ ...s, energy: report }));
    TestBed.inject(TileData);
    await settle();
    const fixture = TestBed.createComponent(EnergyTile);
    fixture.componentRef.setInput('settings', settings);
    fixture.componentRef.setInput('size', size);
    fixture.detectChanges();
    await settle();
    return fixture;
  }

  // Children of a flex row have no space between them in textContent; join them.
  const text = (el: Element) => [...el.querySelectorAll('dt, dd, span, div')].length && el.matches('dl')
    ? [...el.children].map((c) => [...c.children].map((e) => e.textContent!.trim()).join(' ')).join(' ')
    : el.textContent!.replace(/\s+/g, ' ').trim();

  it('is the energy kind, in the energy hue', () => {
    const kind = ENERGY_TILES.kinds[0];
    expect([kind.id, kind.target, kind.defaultSettings]).toEqual(['energy', 'energy', { target: ENERGY_HOME }]);
  });

  it('shows the grid power as the one number on small, saying it exports', async () => {
    const fixture = await render(energy(), 'small');
    const el = fixture.nativeElement as HTMLElement;

    expect(text(el.querySelector('.hd-energy__now')!)).toBe('650 W');
    expect(text(el.querySelector('.hd-tile__detail')!)).toBe('Exporting');
    expect(el.dataset['kind']).toBe('energy');
    expect(el.querySelector('.hd-energy__flow')).toBeNull();
  });

  it('adds solar, home and the flow bar on wide', async () => {
    const el = (await render(energy(), 'wide')).nativeElement as HTMLElement;

    expect(text(el.querySelector('.hd-energy__figures')!)).toBe('Solar 1.8 kW Home 1.2 kW');
    expect(el.querySelector('.hd-energy__flow')).not.toBeNull();
    expect(el.querySelector('.hd-energy__day')).toBeNull();
  });

  it('adds the day by the hour on large, and today totals on full large', async () => {
    const large = (await render(energy(), 'large')).nativeElement as HTMLElement;
    expect(large.querySelectorAll('.hd-energy__bar-solar')).toHaveLength(6);
    expect(large.querySelector('.hd-energy__today')).toBeNull();

    const full = (await render(energy(), 'full-large')).nativeElement as HTMLElement;
    expect(text(full.querySelector('.hd-energy__today')!)).toBe('Imported 4.2 kWh Exported 3.1 kWh Solar 9.8 kWh Home 10.9 kWh');
  });

  it('says importing when the home takes from the grid', async () => {
    const el = (await render(energy({ live: { grid: 1200, solar: null, home: 1200 } }), 'wide')).nativeElement as HTMLElement;

    expect(text(el.querySelector('.hd-tile__detail')!)).toBe('Importing');
    expect(el.querySelector('.hd-energy__figures')!.textContent).not.toContain('Solar');
  });

  it('is unavailable, not missing, when Homey does not share its energy', async () => {
    const el = (await render({ status: 'unavailable', live: null, day: null })).nativeElement as HTMLElement;

    expect(el.classList).toContain('is-unavailable');
    expect(el.classList).not.toContain('is-missing');
    expect(text(el)).toContain('Energy is not shared by Homey');
  });

  it('waits while Homey has not told, and is missing for a removed account', async () => {
    expect(((await render(null)).nativeElement as HTMLElement).classList).not.toContain('is-unavailable');
    const missing = (await render(energy(), 'wide', { target: ENERGY_HOME, account: 99 })).nativeElement as HTMLElement;
    expect(missing.classList).toContain('is-missing');
  });

  it('opens today in full on a press', async () => {
    const fixture = await render(energy(), 'wide');
    (fixture.nativeElement as HTMLElement).click();
    fixture.detectChanges();

    const pane = (fixture.nativeElement as HTMLElement).querySelector('.hd-energy__pane') as HTMLElement;
    expect(text(pane.querySelector('dl')!)).toContain('Solar now 1.8 kW');
    expect(text(pane.querySelector('dl')!)).toContain('Imported today 4.2 kWh');
  });
});
