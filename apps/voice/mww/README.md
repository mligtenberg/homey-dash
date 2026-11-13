# microWakeWord in the browser

The display listens for "hey jarvis" on the screen itself, so no audio leaves it until the wake word is said.
That used to be openWakeWord through onnxruntime-web (three ONNX models, about 14 MB, tens of ms of CPU per second of
audio). This replaces it with [microWakeWord](https://github.com/kahrendt/microWakeWord): one 28 KB model and a 35 KB
WebAssembly module, about 1-2 ms of CPU per second of audio.

| | |
|---|---|
| `mww.c` | The runtime, one WebAssembly module: the TFLite-Micro audio frontend (40 features per 10 ms) feeding the streaming int8 network, with TFLite's reference int8 arithmetic. Reads any microWakeWord v2 "MixedNet" model; the shape of the network comes from the model file. |
| `export.py` | `.tflite` to the `.bin` the runtime loads (weights, requantisation constants, wiring, the sigmoid table). |
| `build.sh` | Fetches the model and the frontend source (pinned, checksummed), builds with zig through `uv`, writes `../static/mww/`. Run it only to change the model or the runtime. |
| `test.mjs` | `node --test mww/test.mjs` (from `apps/voice`): the known recordings through the module. |
| `../static/mww/` | What the display loads, committed: `mww.js` (wrapper and sliding window), `mww.wasm`, `hey_jarvis.bin`. |

## Behaviour worth knowing

- The score is the average of the last 5 model outputs (one per 30 ms), and counts as the wake word from 0.7. The
  model's own manifest says 0.97, which is stricter: a short or quiet "hey jarvis" averages lower than that.
  The threshold is `THRESHOLD` in `static/mww/mww.js`, and the display reads it from the detector.
- The voice service still hears the wake word itself (openWakeWord, `wakeword.py`) for screens that stream all audio
  (`detect=1`). Only the on-screen detector uses this.
- The module is built for baseline WebAssembly (no SIMD, bulk memory or threads), so old tablet WebViews load it.

## Checked

Against the TFLite interpreter, on recordings: all but a few outputs are identical; the others are off by a few units out
of 255 (TFLite's optimised kernels round slightly differently), with the same peaks.

## Licences

The model is from [esphome/micro-wake-word-models](https://github.com/esphome/micro-wake-word-models) (Apache-2.0),
the frontend from TensorFlow Lite Micro (Apache-2.0) and kissfft (BSD), as packaged by `pymicro-features`.
