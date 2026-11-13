"""Wake phrase + utterance segmentation for the continuous-listen mode.

PoC wake word: the page streams audio, a simple energy VAD cuts it into utterances, Whisper transcribes each one and
a command only runs when the utterance starts with the wake phrase (or follows a bare wake phrase within AWAKE_S).
Works for any Dutch phrase without training, but costs an STT pass per utterance. The production shape is a small
detector on the tablet (openWakeWord / microWakeWord) that only streams audio after it fires.
"""
from __future__ import annotations

import numpy as np
from rapidfuzz import fuzz

from matcher import norm

RATE = 16000
FRAME = RATE // 50          # 20 ms
AWAKE_S = 6.0               # after a bare wake phrase, the next utterance is a command
MIN_SPEECH_FRAMES = 15      # 300 ms
END_SILENCE_FRAMES = 45     # 900 ms: people pause mid-sentence; a half sentence is also held (app.py)
MAX_FRAMES = 12 * 50
PREROLL_FRAMES = 15
START_FRAMES = 3


GREETINGS = {"hey", "he", "hoi", "hallo", "ok", "oke", "hi"}


def split_wake(text: str, wake: str, threshold: int = 80) -> tuple[bool, str]:
    """Does `text` start with the wake word? -> (matched, the rest).
    `wake` is comma-separated spellings: Whisper writes "Homey" as "Homie" or "Homi". An optional greeting before it
    ("hé homie") is allowed, and so are STT splits ("hallo huis" / "hallohuis")."""
    tokens = norm(text).split()
    best, best_cut = 0.0, 0
    for alias in (a for a in wake.split(",") if a.strip()):
        target, n = "".join(norm(alias).split()), len(norm(alias).split())
        for skip in (0, 1) if tokens and tokens[0] in GREETINGS else (0,):
            for k in sorted({max(1, n - 1), n, n + 1}):
                head = "".join(tokens[skip:skip + k])
                if head and (s := fuzz.ratio(head, target)) > best:
                    best, best_cut = s, skip + k
    if best >= threshold:
        return True, " ".join(tokens[best_cut:])
    return False, " ".join(tokens)


class Segmenter:
    """Feed 16 kHz int16 PCM; returns finished utterances as float32 arrays."""

    def __init__(self):
        self._buf = np.zeros(0, np.int16)
        self._floor = 0.005
        self._pre: list[np.ndarray] = []
        self._speech: list[np.ndarray] = []
        self._loud = 0
        self._silent = 0
        self.speaking = False

    def feed(self, pcm: bytes) -> list[np.ndarray]:
        self._buf = np.concatenate([self._buf, np.frombuffer(pcm, np.int16)])
        out = []
        while len(self._buf) >= FRAME:
            frame, self._buf = self._buf[:FRAME], self._buf[FRAME:]
            if (u := self._frame(frame)) is not None:
                out.append(u)
        return out

    def _frame(self, f: np.ndarray):
        rms = float(np.sqrt(np.mean((f.astype(np.float32) / 32768.0) ** 2)))
        loud = rms > max(0.012, 3.0 * self._floor)
        if not self.speaking:
            self._floor = 0.95 * self._floor + 0.05 * rms
            self._pre = (self._pre + [f])[-PREROLL_FRAMES:]
            self._loud = self._loud + 1 if loud else 0
            if self._loud >= START_FRAMES:
                self.speaking, self._speech, self._silent = True, list(self._pre), 0
            return None
        self._speech.append(f)
        # Hysteresis: speech starts above 3x the room's noise but only ends below 1.5x. A tablet's quieter, noisier
        # microphone puts speech barely over the start bar, and the dips between words must not count as silence.
        # (The floor is frozen while speaking, so the speech itself does not raise it.)
        self._silent = 0 if rms > max(0.006, 1.5 * self._floor) else self._silent + 1
        if self._silent >= END_SILENCE_FRAMES or len(self._speech) >= MAX_FRAMES:
            speech, self._speech, self.speaking, self._loud, self._pre = self._speech, [], False, 0, []
            if len(speech) - self._silent < MIN_SPEECH_FRAMES:
                return None
            return np.concatenate(speech).astype(np.float32) / 32768.0
        return None
