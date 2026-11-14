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


def test_a_command_said_while_awake_counts_however_long_transcribing_takes(monkeypatch):
    """The screen arms the socket and sends the command; Whisper then takes longer than the awake window lasts."""
    import time

    import numpy as np

    monkeypatch.setattr(app.wake, "AWAKE_S", 0.3)
    monkeypatch.setattr(app, "prompt", lambda wake_words=app.WAKE: wake_words)

    def slow(audio, bias=None):
        time.sleep(0.6)
        return "zet een timer van vijf seconden"

    monkeypatch.setattr(app, "transcribe_audio", slow)
    t = np.arange(16000) / 16000
    speech = (np.sin(2 * np.pi * 220 * t) * 8000).astype(np.int16)
    audio = np.concatenate([speech, np.zeros(16000 * 2, np.int16)])
    with TestClient(app.app).websocket_connect("/ws/listen?wake=hey%20jarvis") as ws:
        ws.send_text('{"type": "arm"}')
        for i in range(0, len(audio), 1280):
            ws.send_bytes(audio[i:i + 1280].tobytes())
        while (m := ws.receive_json())["type"] != "heard":
            pass
        assert m["armed"]
        while (m := ws.receive_json())["type"] != "result":
            pass
        assert m["action"] == "timer" and m["value"]["seconds"] == 5


def test_prompt_opens_with_the_wake_phrase_of_the_screen(monkeypatch):
    monkeypatch.setattr(app.source, "get", lambda: {"zones": ["Woonkamer"], "devices": []})
    assert app.prompt("hey jarvis,jarvis").startswith("Hey Jarvis, ")
    assert "vijftig" not in app.prompt()
