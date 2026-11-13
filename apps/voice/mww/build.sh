#!/bin/bash
# Rebuilds ../static/mww/: the wake word that runs in the browser (see README.md). Needs uv, curl and python3; nothing is installed globally.
set -euo pipefail
cd "$(dirname "$0")"
OUT=../static/mww
# The official microWakeWord model (Apache-2.0), pinned to a commit and a checksum.
MODEL_URL=https://raw.githubusercontent.com/esphome/micro-wake-word-models/9a72109cc935f77e34cf8ffe7b868155c37ec201/models/v2/hey_jarvis.tflite
MODEL_SHA=21a7976add39ee24ec96c63d96b7aaa18e24d1d9824b963e451da8feb4b78b77
# The TFLite-Micro audio frontend (Apache-2.0) and kissfft (BSD), as packaged by pymicro-features 2.0.2.
SRC_SHA=0d0bed7843ec78b6ced82d1a2dcddeb4fe5df61b3af80a281d0868c8e279c727
SRC_URL=https://files.pythonhosted.org/packages/39/46/328092b4df890385594cf3d3e6015da72d77f63c58d3057276ac2353e891/pymicro_features-2.0.2.tar.gz

W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
check() { [ "$(shasum -a 256 "$1" | cut -d' ' -f1)" = "$2" ] || { echo "checksum mismatch: $1" >&2; exit 1; }; }
curl -sSfL -o "$W/model.tflite" "$MODEL_URL"; check "$W/model.tflite" "$MODEL_SHA"
curl -sSfL -o "$W/src.tgz" "$SRC_URL"; check "$W/src.tgz" "$SRC_SHA"
tar xzf "$W/src.tgz" -C "$W"
R=$(echo "$W"/pymicro_features-*); L=$R/tensorflow/lite/experimental/microfrontend/lib

mkdir -p "$OUT"
uv run -q --python 3.12 --with tflite --with numpy python -I export.py "$W/model.tflite" "$OUT/hey_jarvis.bin"

FE=(); for f in kiss_fft_int16 fft fft_util filterbank filterbank_util frontend frontend_util log_lut log_scale log_scale_util noise_reduction noise_reduction_util pcan_gain_control pcan_gain_control_util window window_util; do FE+=("$L/$f.cc"); done
FE+=("$R/kissfft/kiss_fft.cc" "$R/kissfft/tools/kiss_fftr.cc")
INC=(-I"$R" -I"$R/kissfft" -DFIXED_POINT=16)
# zig bundles clang and the wasm linker. -mcpu=mvp: baseline WebAssembly, so an old tablet WebView can load it too.
Z=(uv run -q --python 3.12 --with ziglang python -I -m ziglang)
T=(-target wasm32-wasi -mcpu=mvp -O3 -DNDEBUG)
mkdir -p "$W/o"
for f in "${FE[@]}"; do "${Z[@]}" c++ "${T[@]}" "${INC[@]}" -std=c++17 -fno-exceptions -fno-rtti -c "$f" -o "$W/o/$(basename "$f" .cc).o"; done
"${Z[@]}" cc "${T[@]}" "${INC[@]}" -c mww.c -o "$W/o/mww.o"
"${Z[@]}" c++ "${T[@]}" -mexec-model=reactor -Wl,--export-dynamic -Wl,--no-entry -Wl,--strip-all -o "$OUT/mww.wasm" "$W"/o/*.o
ls -l "$OUT"
