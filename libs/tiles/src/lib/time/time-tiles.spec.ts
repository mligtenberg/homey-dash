import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TileSize } from '@homey-dash/layout';
import { ClockTile } from './clock-tile';
import { DateTile } from './date-tile';
import { ClockTileSettings, DateTileSettings, digitalTime, handAngles, monthGrid, timerText, weekNumber } from './time-data';
import { TIME_TILES } from './time-tiles';

// Sunday 8 November 2026, 14:05:30 local time.
const AT = new Date(2026, 10, 8, 14, 5, 30);

describe('time helpers', () => {
  it('formats the time in 24 or 12 hours, with the period apart', () => {
    expect(digitalTime(AT, { target: null, hours: 24 }).text).toBe('14:05');
    expect(digitalTime(AT, { target: null, hours: 24, seconds: true }).text).toBe('14:05:30');
    const twelve = digitalTime(AT, { target: null, hours: 12 });
    expect(twelve.text).toBe('2:05');
    expect(twelve.period.toLowerCase()).toBe('pm');
  });

  it('turns the hands of an analog clock continuously', () => {
    expect(handAngles(AT)).toEqual({ hour: 2 * 30 + 2.5, minute: 5 * 6 + 3, second: 180 });
    expect(handAngles(new Date(2026, 0, 1, 0, 0, 0))).toEqual({ hour: 0, minute: 0, second: 0 });
  });

  it('writes the time left on a timer, rounded up', () => {
    expect(timerText(245_000)).toBe('4:05');
    expect(timerText(244_100)).toBe('4:05');
    expect(timerText(3_845_000)).toBe('1:04:05');
    expect(timerText(-5)).toBe('0:00');
  });

  it('numbers weeks by ISO 8601', () => {
    expect(weekNumber(new Date(2026, 10, 8))).toBe(45);
    expect(weekNumber(new Date(2021, 0, 3))).toBe(53);
    expect(weekNumber(new Date(2024, 11, 30))).toBe(1);
  });

  it('lays a month out Monday first, filling the first and last week', () => {
    const weeks = monthGrid(AT);
    // November 2026 starts on a Sunday and ends on a Monday: six weeks.
    expect(weeks.length).toBe(6);
    expect(weeks[0].days.map((d) => d.day)).toEqual([26, 27, 28, 29, 30, 31, 1]);
    expect(weeks[0].days.map((d) => d.inMonth)).toEqual([false, false, false, false, false, false, true]);
    expect(weeks[5].days[0]).toMatchObject({ day: 30, inMonth: true });
    expect(weeks.flatMap((w) => w.days).filter((d) => d.today)).toEqual([{ day: 8, inMonth: true, today: true }]);
    expect(weeks[0].week).toBe(44);
  });

  it('starts a month on its first Monday without a spare week', () => {
    const weeks = monthGrid(new Date(2026, 5, 15));
    expect(weeks[0].days[0]).toMatchObject({ day: 1, inMonth: true });
    expect(weeks.every((w) => w.days.length === 7)).toBe(true);
  });
});

function render<T>(component: new () => T, inputs: { settings: unknown; size: TileSize }): ComponentFixture<T> {
  const fixture = TestBed.createComponent(component);
  fixture.componentRef.setInput('settings', inputs.settings);
  fixture.componentRef.setInput('size', inputs.size);
  fixture.detectChanges();
  return fixture;
}

describe('clock and date tiles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AT);
  });
  afterEach(() => vi.useRealTimers());

  const clock = (settings: ClockTileSettings, size: TileSize = 'small') => render(ClockTile, { settings, size }).nativeElement as HTMLElement;
  const date = (settings: DateTileSettings, size: TileSize) => render(DateTile, { settings, size }).nativeElement as HTMLElement;

  it('registers all as tiles that point at nothing', () => {
    expect(TIME_TILES.kinds.map((k) => [k.id, k.target])).toEqual([
      ['clock', 'none'],
      ['date', 'none'],
      ['timer', 'none'],
    ]);
  });

  it('shows the time, and the date only where there is room', () => {
    expect(clock({ target: null, hours: 24 }).querySelector('.hd-clock__digits')?.textContent).toBe('14:05');
    expect(clock({ target: null, hours: 24 }).querySelector('.hd-clock__date')).toBeNull();
    expect(clock({ target: null, hours: 24 }, 'wide').querySelector('.hd-clock__date')?.textContent?.toLowerCase()).toContain('8');
    expect(clock({ target: null, hours: 24, showDate: false }, 'wide').querySelector('.hd-clock__date')).toBeNull();
  });

  it('keeps time as it passes', () => {
    const fixture = render(ClockTile, { settings: { target: null, hours: 24 }, size: 'small' });
    vi.advanceTimersByTime(60_000);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hd-clock__digits').textContent).toBe('14:06');
  });

  it('draws an analog dial with a second hand only when asked', () => {
    expect(clock({ target: null, style: 'analog' }).querySelectorAll('.hd-clock__hand').length).toBe(2);
    expect(clock({ target: null, style: 'analog', seconds: true }).querySelectorAll('.hd-clock__hand').length).toBe(3);
  });

  it('shows today on a small date tile and the month on a large one', () => {
    const small = date({ target: null }, 'small');
    expect(small.querySelector('.hd-date__number')?.textContent).toBe('8');
    expect(small.querySelector('.hd-date__month')).toBeNull();

    const large = date({ target: null }, 'large');
    expect(large.querySelector('td.is-today')?.textContent).toBe('8');
    expect(large.querySelectorAll('tbody tr').length).toBe(6);
    expect(large.querySelector('.hd-date__week')).toBeNull();
    expect(date({ target: null, weekNumbers: true }, 'large').querySelector('.hd-date__week')?.textContent).toBe('44');
  });
});
