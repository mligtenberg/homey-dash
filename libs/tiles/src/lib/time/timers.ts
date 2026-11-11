import { inject, Injectable, signal } from '@angular/core';
import { Realtime, TimerView } from '@homey-dash/api-client';
import { renderSound, roomImpulse, SOUND_LEVEL, SOUND_REPEAT, SOUND_ROOM } from './timer-sounds';

/** What a timer plays while it rings. */
export type TimerSound = 'beep' | 'bell' | 'chime' | 'kitchen' | 'pulse' | 'siren' | 'musicbox' | 'piano' | 'marimba' | 'flute' | 'harp' | 'none';

export const TIMER_SOUNDS: readonly TimerSound[] = ['beep', 'bell', 'chime', 'kitchen', 'pulse', 'siren', 'musicbox', 'piano', 'marimba', 'flute', 'harp', 'none'];

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

/** How much louder than the sounds are rendered they are played. */
const LOUDER_DB = 5;

const KEY = 'hd-timers';
const SOUND_KEY = 'hd-timer-sound';

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

/** The sound last picked on this screen, kept in its browser; a beep until one is, or if it is no longer a sound. */
function lastSound(): TimerSound {
  const sound = read<TimerSound>(SOUND_KEY, 'beep');
  return TIMER_SOUNDS.includes(sound) ? sound : 'beep';
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
  readonly draft = signal<TimerDraft>({ hours: 0, minutes: 5, seconds: 0, name: '', sound: lastSound() });

  private readonly realtime = inject(Realtime);
  private audio?: AudioContext;
  private room?: ConvolverNode;
  private out?: GainNode;
  private rung = 0;
  private readonly buffers = new Map<TimerSound, AudioBuffer>();
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
    if (!ringing.length) {
      this.rung = 0;
      return;
    }
    // A bell rings on for a few seconds, so it strikes less often than a beep.
    for (const sound of new Set(ringing.map((t) => t.sound))) if (this.rung % SOUND_REPEAT[sound] === 0) this.play(sound);
    this.rung++;
  }

  /** A touch lets the browser play sounds later, so what starts or sets a timer asks for it. */
  private unlock() {
    this.audio ??= typeof AudioContext === 'undefined' ? undefined : new AudioContext();
    void this.audio?.resume();
  }

  /** Everything goes out through here: 5 dB louder, with a limiter so the peaks it lifts don't distort. */
  private master(ctx: AudioContext): AudioNode {
    if (!this.out) {
      const gain = ctx.createGain();
      gain.gain.value = 10 ** (LOUDER_DB / 20);
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      gain.connect(limiter).connect(ctx.destination);
      this.out = gain;
    }
    return this.out;
  }

  private play(sound: TimerSound) {
    const ctx = this.audio;
    if (!ctx || ctx.state !== 'running' || sound === 'none') return;
    let buffer = this.buffers.get(sound);
    if (!buffer) {
      const samples = renderSound(sound, ctx.sampleRate);
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.buffers.set(sound, buffer);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const dry = ctx.createGain();
    dry.gain.value = SOUND_LEVEL[sound];
    source.connect(dry).connect(this.master(ctx));
    if (SOUND_ROOM[sound]) {
      if (!this.room) {
        const impulse = roomImpulse(ctx.sampleRate);
        const room = ctx.createBuffer(2, impulse[0].length, ctx.sampleRate);
        impulse.forEach((channel, i) => room.copyToChannel(channel, i));
        this.room = ctx.createConvolver();
        this.room.buffer = room;
        this.room.connect(this.master(ctx));
      }
      const wet = ctx.createGain();
      wet.gain.value = SOUND_ROOM[sound] * SOUND_LEVEL[sound];
      source.connect(wet).connect(this.room);
    }
    source.start();
  }
}
