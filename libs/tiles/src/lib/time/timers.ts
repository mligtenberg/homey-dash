import { inject, Injectable, signal } from '@angular/core';
import { Realtime, TimerView } from '@homey-dash/api-client';

/** What a timer plays while it rings. */
export type TimerSound = 'beep' | 'bell' | 'chime' | 'kitchen' | 'pulse' | 'siren' | 'musicbox' | 'piano' | 'marimba' | 'flute' | 'harp' | 'ocarina' | 'fanfare' | 'fairy' | 'treasure' | 'village' | 'none';

export const TIMER_SOUNDS: readonly TimerSound[] = ['beep', 'bell', 'chime', 'kitchen', 'pulse', 'siren', 'musicbox', 'piano', 'marimba', 'flute', 'harp', 'ocarina', 'fanfare', 'fairy', 'treasure', 'village', 'none'];

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

/** How often (in seconds) a ringing timer plays its sound again: a bell rings on for a few seconds, a beep is over at once. */
const SOUND_REPEAT: Record<TimerSound, number> = {
  beep: 1, bell: 3, chime: 3, kitchen: 2, pulse: 2, siren: 2, musicbox: 6, piano: 6, marimba: 5, flute: 6, harp: 5,
  ocarina: 10, fanfare: 6, fairy: 6, treasure: 5, village: 7, none: 1,
};

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
  private rung = 0;
  /** The sounds fetched and decoded so far, or on their way; a screen plays from files, so a slow one has nothing to synthesise. */
  private readonly buffers = new Map<TimerSound, AudioBuffer>();
  private readonly loading = new Map<TimerSound, Promise<void>>();
  private tick?: ReturnType<typeof setInterval>;
  /** The sounds playing now, by sound, so stopping a timer can cut them off instead of letting them play out. */
  private readonly playing = new Map<TimerSound, Set<AudioBufferSourceNode>>();

  constructor() {
    this.sync();
    // Any touch of the screen lets the browser play sounds later, so a timer that arrives from elsewhere (set by voice, or
    // on another screen) can still ring here without anyone having started one on this screen.
    for (const event of ['pointerdown', 'keydown']) window.addEventListener(event, () => this.unlock(), { capture: true, passive: true });
    // What was missed while the connection was down arrives with the list again.
    this.realtime.on('Timers', (timers) => this.replace(normalizeAll(timers)));
    this.realtime.whenConnected(() => void this.realtime.timers().then((timers) => this.replace(normalizeAll(timers)), () => undefined));
  }

  add(seconds: number, name = '', sound: TimerSound = this.draft().sound) {
    if (seconds <= 0) return;
    this.unlock();
    void this.load(sound);
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
      const sound = patch.sound;
      void this.load(sound).then(() => this.play(sound));
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
    this.prepare(timers);
    this.silence(timers);
  }

  /** Cuts off the sound of every timer that no longer rings, at once: stopped, restarted, paused or given more time. */
  private silence(timers: Timer[]) {
    const now = Date.now();
    const ringing = new Set(timers.filter((t) => t.paused === undefined && t.end <= now).map((t) => t.sound));
    for (const [sound, sources] of this.playing) {
      if (ringing.has(sound)) continue;
      for (const source of sources) source.stop();
      this.playing.delete(sound);
    }
  }

  /**
   * Gets ready to ring what this screen did not start itself: the audio is made (and resumed where the browser lets it,
   * as it does a page that is listening with the microphone or that was touched before) and the sounds are fetched, so a
   * timer that arrives from elsewhere rings when it runs out.
   */
  private prepare(timers: Timer[]) {
    if (!timers.length) return;
    this.audio ??= typeof AudioContext === 'undefined' ? undefined : new AudioContext();
    void this.audio?.resume().catch(() => undefined);
    for (const sound of new Set(timers.map((t) => t.sound))) void this.load(sound);
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
    void this.audio?.resume().catch(() => undefined);
    // A bell rings on for a few seconds, so it strikes less often than a beep.
    for (const sound of new Set(ringing.map((t) => t.sound))) if (this.rung % SOUND_REPEAT[sound] === 0) this.play(sound);
    this.rung++;
  }

  /** A touch lets the browser play sounds later, so what starts or sets a timer asks for it. */
  private unlock() {
    this.audio ??= typeof AudioContext === 'undefined' ? undefined : new AudioContext();
    void this.audio?.resume();
    void this.load(this.draft().sound);
  }

  /** Fetches and decodes a sound, so it is ready when a timer rings; settles once it is. */
  private load(sound: TimerSound): Promise<void> {
    const ctx = this.audio;
    if (!ctx || sound === 'none' || this.buffers.has(sound)) return Promise.resolve();
    let loading = this.loading.get(sound);
    if (!loading) {
      loading = fetch(new URL(`sounds/${sound}.mp3`, document.baseURI))
        .then((response) => response.arrayBuffer())
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => void this.buffers.set(sound, buffer))
        // Tried again the next time it rings.
        .catch(() => undefined)
        .finally(() => this.loading.delete(sound));
      this.loading.set(sound, loading);
    }
    return loading;
  }

  private play(sound: TimerSound) {
    const ctx = this.audio;
    if (!ctx || ctx.state !== 'running' || sound === 'none') return;
    const buffer = this.buffers.get(sound);
    if (!buffer) {
      // Not here yet: it rings from the next second on.
      void this.load(sound);
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const sources = this.playing.get(sound) ?? new Set<AudioBufferSourceNode>();
    this.playing.set(sound, sources);
    sources.add(source);
    source.onended = () => sources.delete(source);
    source.start();
  }
}
