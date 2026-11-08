import { TileSettings } from '../tile-data';

/** How a clock tile shows the time. */
export type ClockStyle = 'digital' | 'analog';

export interface ClockTileSettings extends TileSettings {
  /** Digital by default. */
  style?: ClockStyle;
  /** 12 or 24 hour time; absent follows the display's language. */
  hours?: 12 | 24;
  /** Whether the seconds show; off by default. */
  seconds?: boolean;
  /** Whether the date shows under, or beside, the time where the size has room; on by default. */
  showDate?: boolean;
}

export interface DateTileSettings extends TileSettings {
  /** Whether a large tile numbers its weeks (ISO 8601); off by default. */
  weekNumbers?: boolean;
}

/** The time as text, with the AM or PM of 12 hour time apart so a tile can set it smaller. */
export function digitalTime(at: Date, settings: ClockTileSettings): { text: string; period: string } {
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: settings.hours === 24 ? '2-digit' : 'numeric',
    minute: '2-digit',
    second: settings.seconds ? '2-digit' : undefined,
    hour12: settings.hours === undefined ? undefined : settings.hours === 12,
  }).formatToParts(at);
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  const text = parts
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim();
  return { text, period };
}

/** The angles, in degrees clockwise from twelve o'clock, of an analog clock's hands. */
export function handAngles(at: Date): { hour: number; minute: number; second: number } {
  const [h, m, s] = [at.getHours() % 12, at.getMinutes(), at.getSeconds()];
  return { hour: h * 30 + m * 0.5, minute: m * 6 + s * 0.1, second: s * 6 };
}

/** `Sunday 8 November`, as the date reads on a clock. */
export function longDate(at: Date): string {
  return at.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** The ISO 8601 week number: the week with the year's first Thursday is week 1, and weeks start on Monday. */
export function weekNumber(at: Date): number {
  const day = new Date(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/** One day of a month's grid: `day` is its number in its own month; `inMonth` is false for the days that fill the first and last week. */
export interface GridDay {
  day: number;
  inMonth: boolean;
  today: boolean;
}

export interface GridWeek {
  /** The ISO week number. */
  week: number;
  days: GridDay[];
}

/** The weeks of the month `at` is in, Monday first, with the days of the neighbouring months that fill them. */
export function monthGrid(at: Date): GridWeek[] {
  const first = new Date(at.getFullYear(), at.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const weeks: GridWeek[] = [];
  for (let day = new Date(start); day.getMonth() === at.getMonth() || day <= first; ) {
    const days: GridDay[] = [];
    // Thursday decides which year and month a week belongs to, and so its number.
    const thursday = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 3);
    for (let i = 0; i < 7; i++, day.setDate(day.getDate() + 1)) {
      days.push({
        day: day.getDate(),
        inMonth: day.getMonth() === at.getMonth(),
        today: day.getFullYear() === at.getFullYear() && day.getMonth() === at.getMonth() && day.getDate() === at.getDate(),
      });
    }
    weeks.push({ week: weekNumber(thursday), days });
  }
  return weeks;
}

/** The short weekday names, Monday first, in the display's language: `Mon`. */
export function weekdayNames(): string[] {
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));
}
