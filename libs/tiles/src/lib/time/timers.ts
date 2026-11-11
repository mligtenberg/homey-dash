import { inject, Injectable, signal } from '@angular/core';
import { Realtime, TimerView } from '@homey-dash/api-client';

/** What a timer plays while it rings. */
export type TimerSound = 'beep' | 'bell' | 'chime' | 'none';

export const TIMER_SOUNDS: readonly TimerSound[] = ['beep', 'bell', 'chime', 'none'];

/** A timer: running, it ends at `end` (ms since the epoch), so it survives a reload; paused, `paused` is what is left (ms). */
export interface Timer {
  id: string;
  /** Its length so far, in seconds, which time added to it lengthens. */
  seconds: number;
  end: number;
  paused?: number;
  name?: string;
  sound: TimerSound;
}

/** What is left on a timer (ms), negative once it ran out. */
export function timerLeft(timer: Timer, now: number): number {
  return timer.paused ?? timer.end - now;
}

/** What a new timer is started with: the length set in the modal, its name and its sound. */
export interface TimerDraft {
  hours: number;
  minutes: number;
  seconds: number;
  name: string;
  sound: TimerSound;
}

const KEY = 'hd-timers';
const SOUND_KEY = 'hd-timer-sound';

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the timers just don't survive a reload.
  }
}

/** A timer as the backend or the cache gives it: nothing is null, an unknown sound beeps, and a timer from before ids were strings is dropped. */
function normalize(t: Partial<TimerView>): Timer | undefined {
  if (typeof t.id !== 'string' || typeof t.end !== 'number' || typeof t.seconds !== 'number') return undefined;
  return {
    id: t.id,
    seconds: t.seconds,
    end: t.end,
    paused: t.paused ?? undefined,
    name: t.name ?? undefined,
    sound: TIMER_SOUNDS.includes(t.sound as TimerSound) ? (t.sound as TimerSound) : 'beep',
  };
}

function normalizeAll(timers: unknown): Timer[] {
  return Array.isArray(timers) ? timers.map(normalize).filter((t): t is Timer => !!t) : [];
}

function view(t: Timer): TimerView {
  return { id: t.id, seconds: t.seconds, end: t.end, paused: t.paused ?? null, name: t.name ?? null, sound: t.sound };
}

function load(): Timer[] {
  return normalizeAll(read<unknown>(KEY, []));
}

/**
 * The timers, shared by all timer tiles on every screen: the backend keeps them and tells each screen of a change, and
 * the last ones seen are cached here so a reload shows them at once. A timer that ran out rings on every screen, with its
 * sound once a second, until it is removed, restarted or given more time.
 */
@Injectable({ providedIn: 'root' })
export class Timers {
  readonly timers = signal<Timer[]>(load());
  /** The time now (ms), ticking each second while any timer exists. */
  readonly now = signal(Date.now());
  /** What the modal starts a new timer with; the sound is the one last picked. */
  readonly draft = signal<TimerDraft>({ hours: 0, minutes: 5, seconds: 0, name: '', sound: read<TimerSound>(SOUND_KEY, 'beep') });

  private readonly realtime = inject(Realtime);
  private audio?: AudioContext;
  private tick?: ReturnType<typeof setInterval>;

  constructor() {
    this.sync();
    // What was missed while the connection was down arrives with the list again.
    this.realtime.on('Timers', (timers) => this.replace(normalizeAll(timers)));
    this.realtime.whenConnected(() => void this.realtime.timers().then((timers) => this.replace(normalizeAll(timers)), () => undefined));
  }

  add(seconds: number, name = '', sound: TimerSound = this.draft().sound) {
    if (seconds <= 0) return;
    this.unlock();
    this.save({ id: crypto.randomUUID(), seconds, end: Date.now() + seconds * 1000, name: name.trim() || undefined, sound });
  }

  /** Starts a timer from what the modal is set to. */
  start() {
    const { hours, minutes, seconds, name, sound } = this.draft();
    this.add(hours * 3600 + minutes * 60 + seconds, name, sound);
    this.draft.update((d) => ({ ...d, name: '' }));
  }

  setDraft(patch: Partial<TimerDraft>) {
    this.draft.update((d) => ({ ...d, ...patch }));
    if (patch.sound) {
      write(SOUND_KEY, patch.sound);
      this.unlock();
      this.play(patch.sound);
    }
  }

  remove(id: string) {
    this.replace(this.timers().filter((t) => t.id !== id));
    void this.realtime.removeTimer(id).catch(() => undefined);
  }

  pause(id: string) {
    this.change(id, (t, now) => ({ ...t, paused: Math.max(0, t.end - now) }));
  }

  resume(id: string) {
    this.change(id, (t, now) => ({ ...t, end: now + (t.paused ?? 0), paused: undefined }));
  }

  /** Gives the timer more time; one that ran out runs again for that long. */
  addTime(id: string, seconds: number) {
    this.change(id, (t, now) => {
      if (t.paused !== undefined) return { ...t, seconds: t.seconds + seconds, paused: t.paused + seconds * 1000 };
      const ran = t.end <= now;
      return { ...t, seconds: ran ? seconds : t.seconds + seconds, end: (ran ? now : t.end) + seconds * 1000 };
    });
  }

  /** Runs the timer again from its full length. */
  restart(id: string) {
    this.change(id, (t, now) => ({ ...t, end: now + t.seconds * 1000, paused: undefined }));
  }

  private change(id: string, fn: (timer: Timer, now: number) => Timer) {
    const timer = this.timers().find((t) => t.id === id);
    if (!timer) return;
    const now = Date.now();
    this.now.set(now);
    this.save(fn(timer, now));
  }

  /** Shows a started or changed timer at once and tells the backend, which tells every other screen. */
  private save(timer: Timer) {
    this.replace(this.timers().some((t) => t.id === timer.id) ? this.timers().map((t) => (t.id === timer.id ? timer : t)) : [...this.timers(), timer]);
    void this.realtime.saveTimer(view(timer)).catch(() => undefined);
  }

  private replace(timers: Timer[]) {
    this.timers.set(timers);
    write(KEY, timers);
    this.sync();
  }

  private sync() {
    if (this.timers().length && !this.tick) {
      this.now.set(Date.now());
      this.tick = setInterval(() => this.onTick(), 1000);
    } else if (!this.timers().length && this.tick) {
      clearInterval(this.tick);
      this.tick = undefined;
    }
  }

  private onTick() {
    this.now.set(Date.now());
    const ringing = this.timers().filter((t) => t.paused === undefined && t.end <= this.now());
    for (const sound of new Set(ringing.map((t) => t.sound))) this.play(sound);
  }

  /** A touch lets the browser play sounds later, so what starts or sets a timer asks for it. */
  private unlock() {
    this.audio ??= typeof AudioContext === 'undefined' ? undefined : new AudioContext();
    void this.audio?.resume();
  }

  private play(sound: TimerSound) {
    const ctx = this.audio;
    if (!ctx || ctx.state !== 'running' || sound === 'none') return;
    // [seconds after now, hertz, seconds it sounds, type]
    const notes: readonly [number, number, number, OscillatorType][] =
      sound === 'beep'
        ? [[0, 880, 0.12, 'square'], [0.2, 880, 0.12, 'square'], [0.4, 880, 0.12, 'square']]
        : sound === 'bell'
          ? [[0, 660, 0.9, 'sine'], [0, 1320, 0.5, 'sine']]
          : [[0, 523, 0.45, 'sine'], [0.25, 784, 0.7, 'sine']];
    for (const [at, hz, length, type] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + at;
      osc.type = type;
      osc.frequency.value = hz;
      // A short attack and a fall to silence, so it never clicks.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(type === 'square' ? 0.12 : 0.25, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + length + 0.02);
    }
  }
}
