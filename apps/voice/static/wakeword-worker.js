// Runs the wake word detector off the page's main thread (the display page keeps drawing while it listens).
// Messages in: {type:'init'}, {type:'feed', samples: Float32Array (16 kHz mono)}, {type:'reset'}.
// Messages out, in order: {type:'ready'} | {type:'error', message}, and one {type:'score', score} per feed.
importScripts('vendor/ort/ort.wasm.min.js');

let ww;
const ready = import('./wakeword.js').then(({ WakeWord }) => WakeWord.create(self.ort)).then((w) => { ww = w; });

// One message at a time, in the order they came: a reset must not overtake a feed that is still running.
let chain = Promise.resolve();
self.onmessage = ({ data }) => {
  chain = chain.then(async () => {
    try {
      if (data.type === 'init') {
        await ready;
        self.postMessage({ type: 'ready' });
      } else if (data.type === 'reset') {
        ww.reset();
      } else if (data.type === 'feed') {
        self.postMessage({ type: 'score', score: await ww.feed(data.samples) });
      }
    } catch (e) {
      self.postMessage({ type: 'error', message: String(e && e.message || e) });
    }
  });
};
