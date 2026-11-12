// openWakeWord in the browser: audio -> melspectrogram.onnx -> embedding_model.onnx -> <wake word>.onnx.
// Same pipeline as openWakeWord's Python AudioFeatures, run with onnxruntime-web (wasm, single thread).
// Feed 16 kHz mono float32 [-1, 1]; every 80 ms (1280 samples) it produces a score 0..1.
const CHUNK = 1280;          // 80 ms
const MEL_CONTEXT = 160 * 3; // extra samples the mel model needs before each chunk
const EMB_FRAMES = 76;       // mel frames per embedding
const WW_FEATURES = 16;      // embeddings per wake word prediction

export class WakeWord {
  static async create(ort, base = new URL('./models/', import.meta.url).href, wakeModel = 'hey_jarvis_v0.1.onnx') {
    ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;
    ort.env.wasm.numThreads = 1; // no cross-origin isolation on a plain LAN page
    const opt = { executionProviders: ['wasm'] };
    const [mel, emb, ww] = await Promise.all(
      ['melspectrogram.onnx', 'embedding_model.onnx', wakeModel].map(m => ort.InferenceSession.create(base + m, opt)));
    return new WakeWord(ort, mel, emb, ww);
  }

  constructor(ort, mel, emb, ww) {
    Object.assign(this, { ort, mel, emb, ww });
    this.reset();
    this.queue = Promise.resolve();
  }

  reset() {
    this.pending = new Float32Array(0);
    this.raw = new Float32Array(0);
    this.melFrames = Array.from({ length: EMB_FRAMES }, () => new Float32Array(32).fill(1));
    this.feats = [];
    this.frames = 0;
  }

  // Resolves to the highest score seen in this block (serialised: blocks are processed in order).
  feed(f32) {
    const run = this.queue.then(() => this._feed(f32));
    this.queue = run.catch(() => {});
    return run;
  }

  async _feed(f32) {
    const cat = new Float32Array(this.pending.length + f32.length);
    cat.set(this.pending); cat.set(f32, this.pending.length);
    let best = 0, off = 0;
    for (; off + CHUNK <= cat.length; off += CHUNK) best = Math.max(best, await this._chunk(cat.subarray(off, off + CHUNK)));
    this.pending = cat.slice(off);
    return best;
  }

  async _chunk(chunk) {
    const { Tensor } = this.ort;
    const keep = new Float32Array(Math.min(this.raw.length + CHUNK, CHUNK + MEL_CONTEXT));
    const all = new Float32Array(this.raw.length + CHUNK); all.set(this.raw); all.set(chunk, this.raw.length);
    keep.set(all.subarray(all.length - keep.length));
    this.raw = keep;

    // the models expect int16-scaled samples
    const x = new Float32Array(keep.length);
    for (let i = 0; i < keep.length; i++) x[i] = keep[i] * 32767;
    const m = await this.mel.run({ [this.mel.inputNames[0]]: new Tensor('float32', x, [1, x.length]) });
    const md = m[this.mel.outputNames[0]];
    const n = md.dims[md.dims.length - 2];
    for (let f = 0; f < n; f++) {
      const row = new Float32Array(32);
      for (let k = 0; k < 32; k++) row[k] = md.data[f * 32 + k] / 10 + 2;
      this.melFrames.push(row);
    }
    if (this.melFrames.length > EMB_FRAMES + 8) this.melFrames.splice(0, this.melFrames.length - EMB_FRAMES - 8);

    const win = this.melFrames.slice(-EMB_FRAMES), flat = new Float32Array(EMB_FRAMES * 32);
    win.forEach((r, i) => flat.set(r, i * 32));
    const e = await this.emb.run({ [this.emb.inputNames[0]]: new Tensor('float32', flat, [1, EMB_FRAMES, 32, 1]) });
    this.feats.push(Float32Array.from(e[this.emb.outputNames[0]].data));
    if (this.feats.length > WW_FEATURES) this.feats.shift();
    this.frames++;
    if (this.feats.length < WW_FEATURES) return 0;

    const f = new Float32Array(WW_FEATURES * 96);
    this.feats.forEach((r, i) => f.set(r, i * 96));
    const s = await this.ww.run({ [this.ww.inputNames[0]]: new Tensor('float32', f, [1, WW_FEATURES, 96]) });
    return this.frames < 5 ? 0 : s[this.ww.outputNames[0]].data[0]; // like openWakeWord: ignore the first frames
  }
}
