import type { TimerSound } from './timers';

/*
 * The timer sounds, synthesised: nothing here runs on a screen. `npm run sounds` renders them (see tools/render-sounds.mts)
 * to the MP3 files the display plays from apps/display/public/sounds, so a slow tablet only decodes them.
 */

/** One mode of a struck or plucked body: its frequency relative to the pitch, loudness and how long it takes to fall 60 dB (seconds). */
type Mode = readonly [ratio: number, amp: number, decay: number];

interface VoiceOptions {
  velocity?: number;
  /** Scales every mode's decay time. */
  decay?: number;
  /** Detune (Hz) of each mode's twin, whose beating is a bell's shimmer or a piano's two strings; 0 for no twin. */
  beat?: number;
  /** A held note: sounds this many seconds, then dies away over `release`. */
  hold?: number;
  release?: number;
  /** How loud the strike's click is. */
  click?: number;
  seed?: number;
}

const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);

/** Deterministic noise, so a sound renders the same every time. */
function noise(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/**
 * Sounds a struck or plucked body at `at` seconds: every mode a decaying sine, doubled with a slightly detuned twin,
 * plus the click of the strike. Each sine is a decaying phasor stepped sample by sample, which is cheap and exact enough.
 */
function voice(out: Float32Array, rate: number, at: number, pitch: number, modes: readonly Mode[], o: VoiceOptions = {}) {
  const { velocity = 1, decay = 1, beat = 1, hold, release = 0.15, click = 0.25, seed = 1 } = o;
  const first = Math.floor(at * rate);
  const longest = Math.max(...modes.map(([, , d]) => d)) * decay;
  const reach = Math.min(out.length - first, Math.floor((hold === undefined ? longest : Math.min(longest, hold + release * 6)) * rate));
  if (reach <= 0) return;
  const gate = new Float32Array(reach).fill(1);
  if (hold !== undefined) for (let i = Math.floor(hold * rate); i < reach; i++) gate[i] = Math.exp(-(i - hold * rate) / (release * rate));
  modes.forEach(([ratio, amp, t60], m) => {
    const f = pitch * ratio;
    if (f > rate * 0.45) return;
    const d = Math.exp(-6.9 / (t60 * decay * rate));
    const length = Math.min(reach, Math.floor(t60 * decay * rate));
    for (const [twin, share] of beat ? ([[0, 1], [beat * (0.7 + 0.45 * ((m * 7) % 5)), 0.6]] as const) : ([[0, 1]] as const)) {
      const w = (2 * Math.PI * (f + twin)) / rate;
      const phase = m * 1.3 + twin;
      const level = amp * share * velocity;
      const [rr, ri] = [d * Math.cos(w), d * Math.sin(w)];
      let [x, y] = [level * Math.cos(phase), level * Math.sin(phase)];
      for (let i = 0; i < length; i++) {
        out[first + i] += y * gate[i];
        [x, y] = [x * rr - y * ri, x * ri + y * rr];
      }
    }
  });
  // The strike itself: a few milliseconds of differentiated noise.
  const rand = noise(seed);
  const clicks = Math.floor(0.008 * rate);
  let prev = 0;
  for (let i = 0; i < clicks && first + i < out.length; i++) {
    const n = rand();
    out[first + i] += (n - prev) * click * velocity * (1 - i / clicks);
    prev = n;
  }
}

/** A tuned bell: hum, prime, minor-third tierce, quint, nominal and the inharmonic overtones above, the high ones dying first. */
const BELL: readonly Mode[] = [
  [0.5, 0.5, 2.4], [1, 1, 1.8], [1.183, 0.8, 1.5], [1.506, 0.35, 1.1], [2, 0.7, 1.0], [2.514, 0.3, 0.65],
  [2.662, 0.35, 0.6], [3.011, 0.25, 0.5], [4.166, 0.25, 0.38], [5.433, 0.15, 0.26], [6.796, 0.1, 0.18], [8.215, 0.06, 0.12],
];
/** A struck tubular bar (free-free): the overtones sit at 2.76, 5.40 and 8.93 times the pitch. */
const BAR: readonly Mode[] = [[1, 1, 1.5], [2.756, 0.42, 0.7], [5.404, 0.2, 0.3], [8.933, 0.08, 0.14]];
/** A music box's steel tine (a cantilever beam): overtones at 6.27 and 17.55 times the pitch, dying quickly. */
const TINE: readonly Mode[] = [[1, 1, 1.7], [6.27, 0.3, 0.45], [17.55, 0.08, 0.15]];
/** A marimba bar, tuned so its overtones are the 4th and the 10th harmonics: warm and short. */
const MARIMBA: readonly Mode[] = [[1, 1, 0.9], [4, 0.4, 0.3], [10, 0.1, 0.09]];
/** A small dish bell, as on a kitchen timer. */
const DISH: readonly Mode[] = [[1, 1, 0.22], [2.32, 0.45, 0.13], [4.1, 0.2, 0.08]];

/** A piano string: harmonics stretched by a little inharmonicity, the hammer's strike point thinning some of them, the high ones dying first. */
function pianoModes(f: number): Mode[] {
  const t60 = 5 * (110 / f) ** 0.4;
  return Array.from({ length: 14 }, (_, i): Mode => {
    const k = i + 1;
    return [k * Math.sqrt(1 + 0.00025 * (f / 110) * k * k), (1 / k ** 0.9) * (0.35 + Math.abs(Math.sin(Math.PI * k * 0.12))), t60 / (1 + 0.6 * i)];
  });
}

/** A harp string, plucked a little off its middle. */
function harpModes(f: number): Mode[] {
  return Array.from({ length: 10 }, (_, i): Mode => {
    const k = i + 1;
    return [k, (1 / k ** 1.2) * (0.3 + Math.abs(Math.sin(Math.PI * k * 0.28))), (3.2 / (1 + 0.5 * i)) * (261 / f) ** 0.3];
  });
}

/** A piezo alarm clock: four quick beeps of a band-limited square wave, then a gap. */
function beeps(out: Float32Array, rate: number) {
  const pitch = 2600;
  const on = Math.floor(0.085 * rate);
  const edge = Math.floor(0.004 * rate);
  for (let b = 0; b < 4; b++) {
    const first = Math.floor(b * 0.16 * rate);
    for (let i = 0; i < on; i++) {
      let v = 0;
      for (let k = 1; pitch * k < rate * 0.45; k += 2) v += Math.sin((2 * Math.PI * pitch * k * i) / rate) / k;
      out[first + i] += v * Math.min(1, i / edge, (on - i) / edge);
    }
  }
}

/** A plain tone with a hint of its third harmonic and soft edges. */
function tone(out: Float32Array, rate: number, at: number, hz: number, length: number, level: number) {
  const first = Math.floor(at * rate);
  const n = Math.floor(length * rate);
  const edge = Math.floor(0.006 * rate);
  for (let i = 0; i < n && first + i < out.length; i++) {
    const p = (2 * Math.PI * hz * i) / rate;
    out[first + i] += level * (Math.sin(p) + 0.25 * Math.sin(3 * p)) * Math.min(1, i / edge, (n - i) / edge);
  }
}

/** A siren: a note that swells and falls twice, with a few harmonics. */
function siren(out: Float32Array, rate: number) {
  let phase = 0;
  const edge = Math.floor(0.03 * rate);
  for (let i = 0; i < out.length; i++) {
    phase += (2 * Math.PI * (650 + 450 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / rate / 0.8)))) / rate;
    out[i] = (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.33 * Math.sin(3 * phase)) * Math.min(1, i / edge, (out.length - i) / edge);
  }
}

/** A flute: a breathy attack, a few harmonics and a slow vibrato that comes in after the note starts. */
function flute(out: Float32Array, rate: number, at: number, hz: number, length: number, seed: number) {
  const first = Math.floor(at * rate);
  const rand = noise(seed);
  let [phase, breath] = [0, 0];
  for (let i = 0; i < Math.floor((length + 0.15) * rate) && first + i < out.length; i++) {
    const t = i / rate;
    phase += (2 * Math.PI * hz * (1 + 0.004 * Math.min(1, t / 0.3) * Math.sin(2 * Math.PI * 5.2 * t))) / rate;
    breath += (rand() - breath) * 0.25;
    const env = (1 - Math.exp(-t / 0.035)) * (t > length ? Math.exp(-(t - length) / 0.05) : 1);
    const tonal = Math.sin(phase) + 0.35 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase) + 0.04 * Math.sin(4 * phase);
    out[first + i] += env * (tonal * 0.5 + breath * (0.1 + 0.25 * Math.exp(-t / 0.05)));
  }
}

type Tune = readonly (readonly [at: number, note: number, length?: number])[];

/** "Twinkle, Twinkle" (Mozart's theme), high on a music box. */
const TWINKLE: Tune = [84, 84, 91, 91, 93, 93, 91, 89, 89, 88, 88, 86, 86, 84].map((n, i) => [i * 0.25 + (i > 6 ? 0.1 : 0), n] as const);
/** The opening of Beethoven's "Für Elise". */
const ELISE: Tune = [
  [0, 76], [0.17, 75], [0.34, 76], [0.51, 75], [0.68, 76], [0.85, 71], [1.02, 74], [1.19, 72], [1.36, 69, 0.4],
  [1.9, 60], [2.07, 64], [2.24, 69], [2.41, 71, 0.4], [2.95, 64], [3.12, 68], [3.29, 71], [3.46, 72, 0.7],
];
/** The theme of Beethoven's "Ode to Joy". */
const ODE: Tune = [76, 76, 77, 79, 79, 77, 76, 74, 72, 72, 74, 76].map((n, i) => [i * 0.2, n] as const).concat([[2.4, 76], [2.85, 74], [3.05, 74]] as never[]);
/** A slow, rising and falling figure for the flute, in the spirit of a morning in the mountains. */
const MORNING: Tune = [
  [0, 71, 0.3], [0.3, 68, 0.3], [0.6, 66, 0.3], [0.9, 64, 0.3], [1.2, 66, 0.3], [1.5, 68, 0.3],
  [1.8, 71, 0.3], [2.1, 68, 0.3], [2.4, 66, 0.3], [2.7, 64, 0.3], [3.0, 66, 0.3], [3.3, 68, 0.3], [3.6, 71, 0.5], [4.15, 73, 0.8],
];

/** How long each sound is, in seconds. */
const LENGTH: Record<Exclude<TimerSound, 'none'>, number> = {
  beep: 0.9, bell: 3.4, chime: 3.2, kitchen: 1.4, pulse: 1.4, siren: 1.6, musicbox: 5, piano: 5, marimba: 4.2, flute: 6, harp: 4,
};

/** What a sound is, as samples at the given rate, scaled to peak at 0.9; empty for silence. */
export function renderSound(sound: TimerSound, rate: number): Float32Array<ArrayBuffer> {
  if (sound === 'none') return new Float32Array(0);
  const out = new Float32Array(Math.floor(rate * LENGTH[sound]));
  switch (sound) {
    case 'beep':
      beeps(out, rate);
      break;
    case 'bell':
      voice(out, rate, 0, 784, BELL);
      break;
    case 'chime':
      [[0, 1047, 0.9], [0.3, 1319, 0.95], [0.6, 1568, 1]].forEach(([at, hz, velocity], n) =>
        voice(out, rate, at, hz, BAR, { velocity, decay: hz > 1500 ? 1.4 : 1.1, seed: n + 3 }),
      );
      break;
    case 'kitchen': {
      // A hammer beating two dish bells in turn.
      const rand = noise(5);
      for (let k = 0; k < 24; k++) voice(out, rate, k / 24, k % 2 ? 2760 : 2300, DISH, { velocity: 0.7 + 0.3 * Math.abs(rand()), beat: 3, click: 0.6, seed: k + 1 });
      break;
    }
    case 'pulse':
      [0, 0.4, 0.8].forEach((at) => {
        tone(out, rate, at, 988, 0.09, 1);
        tone(out, rate, at + 0.12, 1319, 0.09, 1);
      });
      break;
    case 'siren':
      siren(out, rate);
      break;
    case 'musicbox':
      TWINKLE.forEach(([at, note], n) => voice(out, rate, at, midi(note), TINE, { beat: 0.3, seed: n + 1 }));
      break;
    case 'piano':
      ELISE.forEach(([at, note, length = 0.17], n) => {
        const hz = midi(note);
        voice(out, rate, at, hz, pianoModes(hz), { beat: 0.35, hold: Math.max(0.3, length * 1.6), release: 0.18, click: 0.12, velocity: 0.85 + 0.15 * ((n * 7) % 3) / 2, seed: n + 1 });
      });
      break;
    case 'marimba':
      ODE.forEach(([at, note], n) => voice(out, rate, at, midi(note), MARIMBA, { beat: 0, decay: (300 / midi(note)) ** 0.2, click: 0.4, seed: n + 1 }));
      break;
    case 'flute':
      MORNING.forEach(([at, note, length = 0.3], n) => flute(out, rate, at, midi(note) * 2, length, n + 1));
      break;
    case 'harp': {
      // A run up the strings, then the chord it lands on.
      [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96].forEach((note, n) => voice(out, rate, n * 0.075, midi(note), harpModes(midi(note)), { beat: 0.4, click: 0.1, velocity: 0.6, seed: n + 1 }));
      [72, 79, 84].forEach((note, n) => voice(out, rate, 1.05, midi(note), harpModes(midi(note)), { beat: 0.4, click: 0.12, seed: n + 20 }));
      break;
    }
  }
  // A short fade at the very end, then the loudest sample at 0.9.
  const fade = Math.floor(0.08 * rate);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
  return out;
}

/** Puts a sound in a room (a Freeverb: parallel damped combs into series allpasses), `wet` being how much of the room is heard; the sound is followed by the room's tail. */
export function addRoom(dry: Float32Array, rate: number, wet: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(dry.length + (wet ? Math.floor(rate * 1.4) : 0));
  const scale = rate / 44100;
  const delay = (samples: number) => ({ buf: new Float32Array(Math.round(samples * scale)), at: 0, store: 0 });
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(delay);
  const allpasses = [556, 441, 341, 225].map(delay);
  for (let i = 0; i < out.length; i++) {
    const x = i < dry.length ? dry[i] : 0;
    let room = 0;
    if (wet) {
      for (const c of combs) {
        const y = c.buf[c.at];
        c.store = y * 0.8 + c.store * 0.2;
        c.buf[c.at] = x * 0.015 + c.store * 0.84;
        c.at = (c.at + 1) % c.buf.length;
        room += y;
      }
      for (const a of allpasses) {
        const y = a.buf[a.at];
        a.buf[a.at] = room + y * 0.5;
        a.at = (a.at + 1) % a.buf.length;
        room = y - room;
      }
    }
    out[i] = x + wet * 3 * room;
  }
  return out;
}
