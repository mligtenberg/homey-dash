"""openWakeWord on the server: the same pipeline as static/wakeword.js (mel -> embedding -> wake word model), for
screens too slow to run it themselves. Feed 16 kHz int16 PCM; every 80 ms it produces a score 0..1."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import onnxruntime as ort

CHUNK = 1280  # 80 ms
MEL_CONTEXT = 160 * 3
EMB_FRAMES = 76
WW_FEATURES = 16
MODELS = Path(__file__).parent / "static" / "models"


def _session(name: str) -> ort.InferenceSession:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    return ort.InferenceSession(str(MODELS / name), opts, providers=["CPUExecutionProvider"])


class WakeWord:
    def __init__(self, wake_model: str = "hey_jarvis_v0.1.onnx"):
        self.mel, self.emb, self.ww = _session("melspectrogram.onnx"), _session("embedding_model.onnx"), _session(wake_model)
        self.reset()

    def reset(self) -> None:
        self.pending = np.zeros(0, np.float32)
        self.raw = np.zeros(0, np.float32)
        self.mel_frames = [np.ones(32, np.float32)] * EMB_FRAMES
        self.feats: list[np.ndarray] = []
        self.frames = 0

    def feed(self, pcm: bytes) -> float:
        """The highest score in this block."""
        self.pending = np.concatenate([self.pending, np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0])
        best, off = 0.0, 0
        while off + CHUNK <= len(self.pending):
            best = max(best, self._chunk(self.pending[off:off + CHUNK]))
            off += CHUNK
        self.pending = self.pending[off:]
        return best

    def _chunk(self, chunk: np.ndarray) -> float:
        self.raw = np.concatenate([self.raw, chunk])[-(CHUNK + MEL_CONTEXT):]
        m = self.mel.run(None, {self.mel.get_inputs()[0].name: (self.raw * 32767)[None, :]})[0]
        self.mel_frames.extend(m.reshape(-1, 32) / 10 + 2)
        self.mel_frames = self.mel_frames[-(EMB_FRAMES + 8):]
        win = np.stack(self.mel_frames[-EMB_FRAMES:])[None, :, :, None].astype(np.float32)
        self.feats.append(self.emb.run(None, {self.emb.get_inputs()[0].name: win})[0].reshape(96))
        self.feats = self.feats[-WW_FEATURES:]
        self.frames += 1
        if len(self.feats) < WW_FEATURES:
            return 0.0
        score = float(self.ww.run(None, {self.ww.get_inputs()[0].name: np.stack(self.feats)[None].astype(np.float32)})[0][0][0])
        return 0.0 if self.frames < 5 else score
