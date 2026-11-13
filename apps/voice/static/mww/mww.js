// microWakeWord ("hey jarvis") in the browser: mww.wasm holds the TFLite-Micro audio frontend and the int8 network, this adds the
// sliding window ESPHome averages the model's outputs over. Built by apps/voice/mww/build.sh; see apps/voice/mww/README.md.
// Feed 16 kHz mono audio; it works through 10 ms at a time, and the model answers every 30 ms.

/** Average of this many model outputs, and the score from which that average counts as the wake word said. */
const WINDOW = 5;
const THRESHOLD = 0.7;

export class MicroWakeWord {
  /** `base` is the folder with mww.wasm and the model (hey_jarvis.bin); by default the one this file is in. */
  static async create(base = new URL('./', import.meta.url), model = 'hey_jarvis.bin') {
    const [w, b] = await Promise.all([fetch(new URL('mww.wasm', base)), fetch(new URL(model, base))]);
    if (!w.ok || !b.ok) throw new Error(`The wake word could not be loaded: mww.wasm gave HTTP ${w.status}, ${model} gave HTTP ${b.status}`);
    const wasi = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0 }; // imported by the C library, never called: nothing prints
    const { instance } = await WebAssembly.instantiate(await w.arrayBuffer(), { wasi_snapshot_preview1: wasi });
    const x = instance.exports;
    x._initialize();
    const bin = new Uint8Array(await b.arrayBuffer());
    const p = x.mww_alloc(bin.length);
    new Uint8Array(x.memory.buffer, p, bin.length).set(bin);
    if (x.mww_init(p)) throw new Error('The wake word model is not one this runtime knows');
    return new MicroWakeWord(x);
  }

  constructor(x) {
    this.x = x;
    this.threshold = THRESHOLD;
    this.probs = [];
    this.pcm = x.mww_alloc(2 * 8000); // room for 0.5 s of audio per call into the module
  }

  reset() {
    this.x.mww_reset();
    this.probs = [];
  }

  /** The highest score (0 to 1) the wake word got while this audio went by: the average of the last 5 outputs, which is 0 until there are 5. */
  feed(samples) {
    const n = samples.length - (samples.length % 160); // whole 10 ms; the blocks of 1280 the display sends are
    let best = 0;
    for (let off = 0; off < n; off += 8000) {
      const len = Math.min(8000, n - off);
      const dst = new Int16Array(this.x.memory.buffer, this.pcm, len); // after any call: the memory may have moved
      for (let i = 0; i < len; i++) dst[i] = Math.max(-32768, Math.min(32767, Math.round(samples[off + i] * 32768))); // rounded, so 16 bit audio goes in as it came
      const k = this.x.mww_feed(this.pcm, len);
      const outs = new Uint8Array(this.x.memory.buffer, this.x.mww_outs(), k);
      for (const o of outs) {
        this.probs.push(o / 256);
        if (this.probs.length > WINDOW) this.probs.shift();
        if (this.probs.length === WINDOW) best = Math.max(best, this.probs.reduce((a, b) => a + b) / WINDOW);
      }
    }
    return best;
  }
}
