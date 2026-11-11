import { TestBed } from '@angular/core/testing';
import { Realtime } from '@homey-dash/api-client';
import { FakeRealtime } from '@homey-dash/api-client/testing';
import { timerLength } from './timer-panel';
import { timerLeft, Timers } from './timers';

describe('Timers', () => {
  let timers: Timers;
  let realtime: FakeRealtime;

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 8, 14, 0, 0));
    realtime = new FakeRealtime();
    TestBed.configureTestingModule({ providers: [{ provide: Realtime, useValue: realtime }] });
    timers = TestBed.inject(Timers);
  });

  afterEach(() => {
    for (const t of timers.timers()) timers.remove(t.id);
    vi.useRealTimers();
  });

  const only = () => timers.timers()[0];

  it('starts timers side by side, with a name and a sound', () => {
    timers.add(300, ' Tea ', 'bell');
    timers.add(60);
    expect(timers.timers().map((t) => [t.seconds, t.name, t.sound])).toEqual([
      [300, 'Tea', 'bell'],
      [60, undefined, 'beep'],
    ]);
    timers.add(0);
    expect(timers.timers().length).toBe(2);
  });

  it('starts from the draft and clears its name', () => {
    timers.setDraft({ hours: 1, minutes: 30, seconds: 0, name: 'Roast' });
    timers.start();
    expect(only()).toMatchObject({ seconds: 5400, name: 'Roast' });
    expect(timers.draft().name).toBe('');
  });

  it('pauses with what is left and resumes from it', () => {
    timers.add(100);
    vi.advanceTimersByTime(30_000);
    timers.pause(only().id);
    expect(timerLeft(only(), Date.now())).toBe(70_000);
    vi.advanceTimersByTime(60_000);
    expect(timerLeft(only(), Date.now())).toBe(70_000);
    timers.resume(only().id);
    expect(timerLeft(only(), Date.now())).toBe(70_000);
    vi.advanceTimersByTime(10_000);
    expect(timerLeft(only(), Date.now())).toBe(60_000);
  });

  it('adds time to a running timer, and runs a finished one again for that long', () => {
    timers.add(60);
    timers.addTime(only().id, 60);
    expect(only().seconds).toBe(120);
    expect(timerLeft(only(), Date.now())).toBe(120_000);
    vi.advanceTimersByTime(130_000);
    expect(timerLeft(only(), Date.now())).toBeLessThan(0);
    timers.addTime(only().id, 60);
    expect(timerLeft(only(), Date.now())).toBe(60_000);
  });

  it('restarts from the full length', () => {
    timers.add(60);
    vi.advanceTimersByTime(90_000);
    timers.restart(only().id);
    expect(timerLeft(only(), Date.now())).toBe(60_000);
  });

  it('shares timers with other screens through the backend', async () => {
    timers.add(60, 'Tea');
    expect(realtime.commands).toContainEqual(['saveTimer', only().id]);
    // Another screen starts one; it arrives with the list, with nothing null.
    realtime.push('Timers', [
      { id: 'other', seconds: 30, end: Date.now() + 30_000, paused: null, name: null, sound: 'bell' },
    ]);
    expect(timers.timers()).toEqual([{ id: 'other', seconds: 30, end: Date.now() + 30_000, paused: undefined, name: undefined, sound: 'bell' }]);
    timers.remove('other');
    expect(realtime.commands).toContainEqual(['removeTimer', 'other']);
  });

  it('takes the backend\'s timers when it connects', async () => {
    realtime.timerList = [{ id: 'kept', seconds: 60, end: Date.now() + 60_000, paused: 20_000, name: 'Roast', sound: 'nonsense' }];
    realtime.reconnect();
    await Promise.resolve();
    await Promise.resolve();
    expect(timers.timers()).toMatchObject([{ id: 'kept', paused: 20_000, name: 'Roast', sound: 'beep' }]);
  });

  it('writes a length in words', () => {
    expect(timerLength(300)).toBe('5 min');
    expect(timerLength(5400)).toBe('1 h 30 min');
    expect(timerLength(45)).toBe('45 s');
  });
});
