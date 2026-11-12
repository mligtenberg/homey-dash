import wave
from pathlib import Path

from fastapi.testclient import TestClient

import app
from wakeword import WakeWord

SAMPLES = Path(__file__).parent / "static" / "samples"


def pcm(name: str) -> bytes:
    with wave.open(str(SAMPLES / name)) as w:
        return w.readframes(w.getnframes())


def best(name: str) -> float:
    det, top, data = WakeWord(), 0.0, pcm(name)
    for i in range(0, len(data), 3200):
        top = max(top, det.feed(data[i:i + 3200]))
    return top


def test_hears_hey_jarvis():
    assert best("hey-jarvis.wav") > 0.5


def test_ignores_other_speech():
    assert best("other-speech.wav") < 0.1


def test_endpoint_matches_detector():
    c = TestClient(app.app)
    body = pcm("hey-jarvis.wav") + b"\0" * 16000
    r = c.post("/api/wake", content=body).json()
    assert r["score"] > 0.5 and 0 < r["at"] < 4
    assert c.post("/api/wake", content=pcm("other-speech.wav")).json()["score"] < 0.1
