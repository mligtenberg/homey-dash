#!/bin/sh
# Wake-word assets for the test page (served locally, nothing is loaded from a CDN at run time).
# Models: openWakeWord v0.5.1 release (Apache-2.0 code; hey_jarvis is CC BY-NC-SA 4.0, see the openWakeWord README).
# Runtime: onnxruntime-web 1.20.1 (MIT).
set -e
cd "$(dirname "$0")"
mkdir -p static/models static/vendor/ort
B=https://github.com/dscripka/openWakeWord/releases/download/v0.5.1
for f in hey_jarvis_v0.1.onnx melspectrogram.onnx embedding_model.onnx; do
  [ -s static/models/$f ] || curl -sSfL -o static/models/$f $B/$f
done
if [ ! -s static/vendor/ort/ort.wasm.min.js ]; then
  T=$(mktemp -d); (cd "$T" && npm pack onnxruntime-web@1.20.1 --silent >/dev/null && tar xzf onnxruntime-web-*.tgz)
  cp "$T"/package/dist/ort.wasm.min.js "$T"/package/dist/ort-wasm-simd-threaded.mjs "$T"/package/dist/ort-wasm-simd-threaded.wasm static/vendor/ort/
  # The runtime asks for a shared memory that may grow to 4 GB, which a tablet's browser (an Android WebView, often a 32 bit
  # process) cannot reserve: "RangeError: WebAssembly.Memory(): could not allocate memory". These models need a few MB; 64 MB is room enough.
  sed -i.bak 's/initial:256,maximum:65536,shared:!0/initial:256,maximum:1024,shared:!0/' static/vendor/ort/ort-wasm-simd-threaded.mjs
  rm -f static/vendor/ort/ort-wasm-simd-threaded.mjs.bak
  grep -q 'maximum:1024' static/vendor/ort/ort-wasm-simd-threaded.mjs
  rm -rf "$T"
fi
