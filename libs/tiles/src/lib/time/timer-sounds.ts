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

/*
 * The adventure set: five original tunes in the manner of a fantasy adventure game's music (an ocarina lullaby, a brass
 * fanfare, a fairy's harp, a treasure jingle and a village dance). Their melodies are written for this app, not taken
 * from any game.
 */

/** An ocarina: a vessel flute, so nearly a pure sine, with a breathy chiff that scoops up to the note and a vibrato that blooms on long notes. */
function ocarina(out: Float32Array, rate: number, at: number, hz: number, length: number, o: { velocity?: number; seed?: number } = {}) {
  const { velocity = 1, seed = 1 } = o;
  const first = Math.floor(at * rate);
  const rand = noise(seed);
  const release = 0.08;
  let [phase, breath, air] = [0, 0, 0];
  for (let i = 0; i < Math.floor((length + release * 6) * rate) && first + i < out.length; i++) {
    const t = i / rate;
    const bloom = Math.min(1, Math.max(0, (t - 0.2) / 0.3));
    const wobble = Math.sin(2 * Math.PI * 5.3 * t);
    phase += (2 * Math.PI * hz * (1 - 0.011 * Math.exp(-t / 0.03) + 0.0045 * bloom * wobble)) / rate;
    // Breath: noise twice smoothed, then voiced by the tone so it sounds at the note rather than as hiss.
    breath += (rand() - breath) * 0.3;
    air += (breath - air) * 0.3;
    const env = (1 - Math.exp(-t / 0.022)) * (t > length ? Math.exp(-(t - length) / release) : 1) * (1 + 0.04 * bloom * wobble);
    const tonal = Math.sin(phase) + 0.09 * Math.sin(2 * phase + 0.4) + 0.035 * Math.sin(3 * phase + 1.1) + 0.012 * Math.sin(4 * phase);
    const chiff = 0.05 + 0.55 * Math.exp(-t / 0.025);
    out[first + i] += velocity * env * (tonal + air * chiff * (1 + Math.sin(phase)) * 2.5);
  }
}

/**
 * A brass voice: a buzzing lip, so all harmonics, whose upper ones come in as it gets louder (the brightness follows the
 * envelope), lifted by the bell's formant around 1.2 kHz. It starts a little flat and settles, and long notes get a vibrato.
 * The harmonics are summed with the Chebyshev recurrence, so it costs one sine per sample.
 */
function brass(out: Float32Array, rate: number, at: number, hz: number, length: number, o: { velocity?: number; cents?: number } = {}) {
  const { velocity = 1, cents = 0 } = o;
  const first = Math.floor(at * rate);
  const f0 = hz * 2 ** (cents / 1200);
  const top = Math.max(1, Math.min(30, Math.floor(Math.min(rate * 0.45, 9000) / (f0 * 1.03))));
  const formant = Array.from({ length: top + 1 }, (_, k) => (1 + 1.6 * Math.exp(-(((k * f0 - 1200) / 750) ** 2))) / (1 + 0.04 * k));
  const release = 0.07;
  let phase = 0;
  for (let i = 0; i < Math.floor((length + release * 6) * rate) && first + i < out.length; i++) {
    const t = i / rate;
    const rise = t < 0.035 ? (t / 0.035) ** 1.6 : 0.82 + 0.18 * Math.exp(-(t - 0.035) / 0.09);
    const env = rise * (t > length ? Math.exp(-(t - length) / release) : 1);
    const vibrato = 0.0035 * Math.min(1, Math.max(0, (t - 0.3) / 0.3)) * Math.sin(2 * Math.PI * 5.5 * t);
    phase += (2 * Math.PI * f0 * (1 - 0.018 * Math.exp(-t / 0.018) + vibrato)) / rate;
    const bright = 0.2 + 0.52 * env * Math.min(1, velocity);
    const c = 2 * Math.cos(phase);
    let [prev, now, gain, sum] = [0, Math.sin(phase), 1, 0];
    for (let k = 1; k <= top; k++) {
      sum += gain * formant[k] * now;
      [prev, now] = [now, c * now - prev];
      gain *= bright;
    }
    out[first + i] += velocity * env * sum * 0.4;
  }
}

/** A section: the same brass note played by a few players, a few cents and milliseconds apart. */
function section(out: Float32Array, rate: number, at: number, note: number, length: number, velocity: number, players = 2) {
  for (let p = 0; p < players; p++) brass(out, rate, at + p * 0.007, midi(note), length, { velocity: velocity / Math.sqrt(players), cents: (p - (players - 1) / 2) * 6 });
}

/** A string pad: three slightly detuned bowed voices per note, swelling in and dying away slowly. */
function strings(out: Float32Array, rate: number, at: number, notes: readonly number[], length: number, level: number) {
  const first = Math.floor(at * rate);
  const [attack, release] = [0.35, 0.7];
  for (const note of notes)
    for (const cents of [-7, 0, 7]) {
      const f0 = midi(note) * 2 ** (cents / 1200);
      const top = Math.min(14, Math.floor(Math.min(rate * 0.45, 6000) / f0));
      let phase = (cents + 7) * 0.31 + note;
      for (let i = 0; i < Math.floor((length + release * 5) * rate) && first + i < out.length; i++) {
        const t = i / rate;
        const env = Math.min(1, t / attack) ** 2 * (t > length ? Math.exp(-(t - length) / release) : 1);
        phase += (2 * Math.PI * f0 * (1 + 0.003 * Math.sin(2 * Math.PI * (4.6 + cents * 0.05) * t))) / rate;
        const c = 2 * Math.cos(phase);
        let [prev, now, gain, sum] = [0, Math.sin(phase), 1, 0];
        for (let k = 1; k <= top; k++) {
          sum += (gain / k) * now;
          [prev, now] = [now, c * now - prev];
          gain *= 0.78;
        }
        out[first + i] += (level / 3) * env * sum;
      }
    }
}

/** Timpani: a tuned kettle drum's membrane modes (near 1, 1.5, 2 and 2.5 times the pitch) with a soft mallet. */
const TIMPANI: readonly Mode[] = [[1, 1, 1.4], [1.504, 0.55, 1.0], [1.742, 0.25, 0.7], [2.0, 0.3, 0.65], [2.245, 0.12, 0.5], [2.494, 0.1, 0.4], [2.8, 0.05, 0.3]];
/** A celesta: steel plates over wooden resonators, so a nearly pure, sweet ring with faint inharmonic overtones. */
const CELESTA: readonly Mode[] = [[1, 1, 1.6], [2.756, 0.1, 0.35], [4, 0.06, 0.22], [5.404, 0.03, 0.12]];

/** A lute string, plucked near the bridge: bright, a little inharmonic, its upper harmonics gone in a moment. */
function luteModes(f: number): Mode[] {
  return Array.from({ length: 14 }, (_, i): Mode => {
    const k = i + 1;
    return [k * Math.sqrt(1 + 0.0004 * k * k), (1 / k ** 0.8) * (0.15 + Math.abs(Math.sin((Math.PI * k) / 5.5))), (2.4 / (1 + 0.45 * i)) * (196 / f) ** 0.35];
  });
}

const harp = (out: Float32Array, rate: number, at: number, note: number, velocity: number, seed: number) =>
  voice(out, rate, at, midi(note), harpModes(midi(note)), { beat: 0.4, click: 0.1, velocity, seed });
const lute = (out: Float32Array, rate: number, at: number, note: number, velocity: number, seed: number) =>
  voice(out, rate, at, midi(note), luteModes(midi(note)), { beat: 0.5, click: 0.18, velocity, seed });
const celesta = (out: Float32Array, rate: number, at: number, note: number, velocity: number, seed: number) =>
  voice(out, rate, at, midi(note), CELESTA, { beat: 0.6, click: 0.08, velocity, seed });

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

/** A lullaby in 3/4 for the ocarina (beat, MIDI note, beats), eight bars long; and the harp's chord in each bar. */
const LULLABY_BEAT = 0.3;
const LULLABY: Tune = [
  [0, 76, 1], [1, 79, 1], [2, 81, 1], [3, 83, 2], [5, 81, 1], [6, 79, 1], [7, 76, 1], [8, 74, 1], [9, 76, 3],
  [12, 76, 1], [13, 79, 1], [14, 81, 1], [15, 86, 2], [17, 84, 1], [18, 83, 1], [19, 81, 1], [20, 78, 1], [21, 79, 3.6],
];
/** C, G/B, Em7, Am, C, D7, D, G: root, fifth, octave, third. */
const LULLABY_CHORDS = [[48, 55, 60, 64], [47, 55, 59, 62], [40, 52, 55, 59], [45, 52, 57, 60], [48, 55, 60, 64], [50, 57, 60, 66], [50, 57, 62, 66]];

/** A fanfare for the brass (second, MIDI note, seconds): a triplet call, a rising answer and a high, held close. */
const FANFARE: Tune = [
  [0, 65, 0.1], [0.13, 65, 0.1], [0.26, 65, 0.1], [0.4, 70, 0.42], [0.85, 72, 0.1], [0.98, 74, 0.1], [1.11, 75, 0.1],
  [1.25, 77, 0.72], [2.05, 74, 0.2], [2.3, 72, 0.2], [2.55, 75, 0.2], [2.8, 82, 1.35],
];
/** What the lower brass hold under it: the chord tones (and their bass) at each of its long notes and in the run home. */
const FANFARE_HARMONY: readonly (readonly [at: number, notes: readonly number[], length: number])[] = [
  [0.4, [46, 58, 62, 65], 0.42], [1.25, [39, 63, 67, 70], 0.72], [2.05, [43, 70], 0.2], [2.3, [41, 69], 0.2], [2.55, [41, 69, 63], 0.2],
  [2.8, [34, 46, 53, 58, 62, 65, 74], 1.35],
];

/** A fairy's harp: maj7 and m7 chords drifting down by half steps, each swept up in one arpeggio, a celesta falling with them. */
const FAIRY_CHORDS = [
  [51, 58, 62, 67, 70, 74, 75, 79], // Ebmaj7
  [50, 57, 60, 65, 69, 72, 74, 77], // Dm7
  [49, 56, 60, 65, 68, 72, 73, 77], // Dbmaj7
  [48, 55, 59, 62, 64, 67, 71, 74, 76, 79], // Cmaj9, where it comes to rest
];

/** A dance in 6/8 for the lute (quaver, MIDI note, quavers), four bars; and its chord on each half bar (bass, then the chord). */
const VILLAGE_STEP = 0.17;
const VILLAGE: Tune = [
  [0, 74, 2], [2, 78, 1], [3, 81, 2], [5, 78, 1], [6, 79, 2], [8, 83, 1], [9, 81, 3],
  [12, 78, 1], [13, 76, 1], [14, 74, 1], [15, 76, 1], [16, 78, 1], [17, 79, 1], [18, 76, 2], [20, 73, 1], [21, 74, 3],
];
const D = [50, [62, 66, 69]] as const;
const G = [43, [62, 67, 71]] as const;
const A7 = [45, [61, 64, 67]] as const;
const VILLAGE_CHORDS = [D, [45, D[1]] as const, G, D, D, A7, A7];

/** How long each sound is, in seconds. */
const LENGTH: Record<Exclude<TimerSound, 'none'>, number> = {
  beep: 0.9, bell: 3.4, chime: 3.2, kitchen: 1.4, pulse: 1.4, siren: 1.6, musicbox: 5, piano: 5, marimba: 4.2, flute: 6, harp: 4,
  ocarina: 9, fanfare: 5, fairy: 5.5, treasure: 4, village: 5.8,
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
    case 'ocarina': {
      const beat = LULLABY_BEAT;
      LULLABY.forEach(([at, note, beats = 1], n) => ocarina(out, rate, at * beat, midi(note), beats * beat * 0.94, { seed: n + 1 }));
      // The harp rocks in quavers under it: root, fifth, octave, third, octave, fifth.
      LULLABY_CHORDS.forEach((chord, bar) =>
        [0, 1, 2, 3, 2, 1].forEach((i, q) => harp(out, rate, (bar * 3 + q / 2) * beat, chord[i], q ? 0.2 : 0.3, bar * 6 + q + 1)),
      );
      // The last bar is one rolled G chord, let ring.
      [43, 50, 55, 59, 62, 67, 71].forEach((note, n) => harp(out, rate, 21 * beat + n * 0.045, note, 0.26, n + 60));
      strings(out, rate, 21 * beat, [55, 59, 62], 1.4, 0.05);
      break;
    }
    case 'fanfare':
      FANFARE.forEach(([at, note, length = 0.2]) => section(out, rate, at, note, length, 1, 3));
      FANFARE_HARMONY.forEach(([at, notes, length]) => notes.forEach((note) => section(out, rate, at + 0.004, note, length, note < 50 ? 0.55 : 0.4)));
      // The timpani: a stroke under the first two long notes, a roll on the dominant, and the last stroke on the tonic.
      voice(out, rate, 0.4, midi(46), TIMPANI, { velocity: 0.9, beat: 0.6, click: 0.5, seed: 1 });
      voice(out, rate, 1.25, midi(39), TIMPANI, { velocity: 0.8, beat: 0.6, click: 0.5, seed: 2 });
      for (let k = 0; k < 8; k++) voice(out, rate, 2.42 + k * 0.045, midi(41), TIMPANI, { velocity: 0.25 + 0.06 * k, decay: 0.6, beat: 0.6, click: 0.4, seed: k + 3 });
      voice(out, rate, 2.8, midi(46), TIMPANI, { velocity: 1.1, decay: 1.3, beat: 0.6, click: 0.6, seed: 20 });
      break;
    case 'fairy': {
      const step = 0.085;
      FAIRY_CHORDS.forEach((chord, c) => {
        const start = c * 0.75;
        chord.forEach((note, n) => harp(out, rate, start + n * step, note, 0.42 + (0.25 * n) / chord.length, c * 12 + n + 1));
        // The celesta's line falls a half step with each chord: Bb, A, Ab, G.
        celesta(out, rate, start, 82 - c, 0.55, c + 70);
        strings(out, rate, start, [chord[0] + 12, chord[1] + 12, chord[3]], c < 3 ? 0.7 : 2.2, 0.035);
      });
      // A last sparkle at the top once the final arpeggio has climbed.
      [88, 91, 95].forEach((note, n) => celesta(out, rate, 3.15 + n * 0.12, note, 0.4 - n * 0.05, n + 80));
      break;
    }
    case 'treasure':
      // A glissando up the strings, then a rising brass call that lands on a held, bell-crowned C major.
      [67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91].forEach((note, n) => harp(out, rate, n * 0.032, note, 0.3 + n * 0.02, n + 1));
      [[0.45, 79], [0.57, 81], [0.69, 83]].forEach(([at, note]) => section(out, rate, at, note, 0.09, 0.85));
      [[0.45, 76], [0.57, 77], [0.69, 79]].forEach(([at, note]) => section(out, rate, at, note, 0.09, 0.55));
      [84, 76, 72, 67, 60, 48].forEach((note) => section(out, rate, 0.82, note, 1.25, note === 84 ? 1 : 0.4));
      voice(out, rate, 0.82, midi(84), BELL, { velocity: 0.35, decay: 1.2, seed: 30 });
      voice(out, rate, 0.82, midi(48), TIMPANI, { velocity: 0.7, beat: 0.6, click: 0.5, seed: 31 });
      [[1.0, 91], [1.16, 96], [1.32, 88], [1.48, 100], [1.64, 93]].forEach(([at, note], n) => celesta(out, rate, at, note, 0.32, n + 40));
      break;
    case 'village': {
      const step = VILLAGE_STEP;
      VILLAGE.forEach(([at, note, steps = 1], n) => {
        lute(out, rate, at * step, note, 0.85, n + 1);
        ocarina(out, rate, at * step, midi(note), steps * step * 0.85, { velocity: 0.22, seed: n + 100 });
      });
      // Oom-pah-pah: the bass on each dotted crotchet, the chord strummed on the two quavers after it.
      VILLAGE_CHORDS.forEach(([bass, chord], half) => {
        lute(out, rate, half * 3 * step, bass, 0.6, half + 200);
        [1, 2].forEach((q) => chord.forEach((note, n) => lute(out, rate, (half * 3 + q) * step + n * 0.012, note, q === 1 ? 0.3 : 0.24, half * 10 + q * 3 + n + 300)));
      });
      // The last half bar is one full D chord, strummed slowly and let ring.
      lute(out, rate, 21 * step, 38, 0.65, 400);
      [50, 57, 62, 66, 69, 74].forEach((note, n) => lute(out, rate, 21 * step + n * 0.028, note, 0.38, n + 401));
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
