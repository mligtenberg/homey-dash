// The browser wake word, run in Node over the known recordings:  node --test mww/test.mjs   (from apps/voice)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MicroWakeWord } from '../static/mww/mww.js';

// Node's fetch does not read file: URLs.
globalThis.fetch = async (url) => ({ ok: true, status: 200, arrayBuffer: async () => readFileSync(url) });

/** The 16 kHz mono 16 bit samples of a recording, as floats. */
function samples(name) {
  const b = readFileSync(new URL(`../static/samples/${name}`, import.meta.url));
  let o = 12;
  while (b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4);
  const n = b.readUInt32LE(o + 4) >> 1;
  return Float32Array.from({ length: n }, (_, i) => b.readInt16LE(o + 8 + 2 * i) / 32768);
}

/** The best score and when (s) it first reached the threshold, feeding 80 ms blocks as the display does. */
async function listen(name) {
  const ww = await MicroWakeWord.create();
  const pcm = samples(name);
  let best = 0;
  let at = null;
  for (let i = 0; i + 1280 <= pcm.length; i += 1280) {
    const score = ww.feed(pcm.subarray(i, i + 1280));
    best = Math.max(best, score);
    if (at === null && score >= ww.threshold) at = i / 16000;
  }
  return { best, at, threshold: ww.threshold };
}

test('hears hey jarvis', async () => {
  const { best, at, threshold } = await listen('hey-jarvis.wav');
  assert.ok(best >= threshold, `best ${best}`);
  assert.ok(at > 0 && at < 4, `at ${at}`);
});

test('ignores other speech', async () => {
  const { best } = await listen('other-speech.wav');
  assert.ok(best < 0.1, `best ${best}`);
});

test('reset forgets what was heard', async () => {
  const ww = await MicroWakeWord.create();
  const pcm = samples('hey-jarvis.wav');
  const run = () => {
    let best = 0;
    for (let i = 0; i + 1280 <= pcm.length; i += 1280) best = Math.max(best, ww.feed(pcm.subarray(i, i + 1280)));
    return best;
  };
  const first = run();
  ww.reset();
  assert.equal(run(), first);
});
