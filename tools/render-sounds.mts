/**
 * Renders the timer sounds to apps/display/public/sounds/*.mp3 (needs ffmpeg): the synthesis in
 * libs/tiles/src/lib/time/timer-sounds.ts, put in a room, made LOUDNESS_GAIN_DB louder than the sounds were first
 * rendered, and kept under full scale by a small look-ahead limiter. A sound whose peaks stop it getting that loud is driven
 * harder into the limiter, up to MAX_DRIVE times, which squashes its peaks and so its attack. Run with `npm run sounds`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addRoom, renderSound } from '../libs/tiles/src/lib/time/timer-sounds.ts';

const RATE = 44100;
const LOUDNESS_GAIN_DB = 15;
/** How much further than the target loudness a sound is driven into the limiter to reach it, at most. */
const MAX_DRIVE = 4;
const CEILING = 0.97;

/** How loud each sound was first played (peak 0.9 times this), and how much of its room is heard. */
const FIRST_LEVEL: Record<string, number> = { beep: 0.55, bell: 0.95, chime: 0.95, kitchen: 0.75, pulse: 0.6, siren: 0.5, musicbox: 0.95, piano: 0.95, marimba: 0.95, flute: 0.95, harp: 0.95 };
const ROOM: Record<string, number> = { beep: 0, bell: 0.22, chime: 0.28, kitchen: 0.05, pulse: 0, siren: 0.05, musicbox: 0.2, piano: 0.2, marimba: 0.15, flute: 0.28, harp: 0.25 };

const rms = (x: Float32Array) => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
const db = (ratio: number) => 20 * Math.log10(ratio);

/** Keeps the sound under the ceiling by turning it down just before and after a peak, which never overshoots. */
function limit(x: Float32Array): Float32Array {
  const w = Math.round(0.005 * RATE);
  const gain = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let env = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(x.length - 1, i + w); j++) env = Math.max(env, Math.abs(x[j]));
    gain[i] = Math.min(1, CEILING / (env || 1));
  }
  return x.map((v, i) => {
    let sum = 0;
    for (let j = i - w; j <= i + w; j++) sum += gain[Math.min(x.length - 1, Math.max(0, j))];
    return (v * sum) / (2 * w + 1);
  });
}

function wav(x: Float32Array): Buffer {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  x.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return b;
}

const out = join(import.meta.dirname, '../apps/display/public/sounds');
const work = mkdtempSync(join(tmpdir(), 'sounds-'));
mkdirSync(out, { recursive: true });
for (const [sound, level] of Object.entries(FIRST_LEVEL)) {
  const dry = renderSound(sound as never, RATE);
  const roomy = addRoom(dry, RATE, ROOM[sound]);
  const before = rms(dry) * level;
  const base = (before * 10 ** (LOUDNESS_GAIN_DB / 20)) / rms(roomy);
  const render = (drive: number) => limit(roomy.map((v) => v * base * drive));
  // The least drive that reaches the target, found by bisection; the most there is when none does.
  let [low, high] = [1, MAX_DRIVE];
  let loud = render(1);
  if (rms(loud) < before * 10 ** (LOUDNESS_GAIN_DB / 20) * 0.98) {
    for (let i = 0; i < 8; i++) {
      const mid = Math.sqrt(low * high);
      if (rms(render(mid)) < before * 10 ** (LOUDNESS_GAIN_DB / 20)) low = mid;
      else high = mid;
    }
    loud = render(high);
  }
  // The tail of the room fades out, so it never ends on a click.
  const fade = Math.floor(0.05 * RATE);
  for (let i = 0; i < fade; i++) loud[loud.length - 1 - i] *= i / fade;
  writeFileSync(join(work, `${sound}.wav`), wav(loud));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(work, `${sound}.wav`), '-codec:a', 'libmp3lame', '-q:a', '0', join(out, `${sound}.mp3`)]);
  console.log(`${sound}: ${(loud.length / RATE).toFixed(1)}s, ${db(rms(loud) / before).toFixed(1)} dB louder than before`);
}
rmSync(work, { recursive: true });
