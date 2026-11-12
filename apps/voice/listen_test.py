"""End-to-end check of /ws/listen with spoken audio (macOS `say`). `uv run python listen_test.py`"""
import os
import subprocess
import tempfile

import numpy as np
from fastapi.testclient import TestClient

from app import app, decode


def say(text):
    p = tempfile.mktemp(suffix=".wav")
    subprocess.run(["say", "-v", "Xander", "-o", p, "--data-format=LEI16@16000", text], check=True)
    a = (decode(p) * 32767).astype(np.int16)
    os.unlink(p)
    return a


SIL = lambda s: np.zeros(int(16000 * s), np.int16)
SCENES = {
    "wake + command in one": [say("Homey, zet de lichten in de woonkamer uit")],
    "bare wake, then command": [say("Homey"), say("doe het licht in de keuken aan")],
    "no wake word (ignored)": [say("zet de lichten in de keuken aan")],
    "wake, but unsupported": [say("Homey, zet de wasmachine aan")],
}
client = TestClient(app)
for name, parts in SCENES.items():
    audio = np.concatenate([SIL(1.0)] + [np.concatenate([p, SIL(1.5)]) for p in parts])
    print(f"== {name}")
    with client.websocket_connect("/ws/listen?engine=rules&zone=woonkamer") as ws:
        ws.receive_json()  # initial state
        for i in range(0, len(audio), 1600):
            ws.send_bytes(audio[i:i + 1600].tobytes())
        heard = 0
        while heard < len(parts):
            m = ws.receive_json()
            if m["type"] == "heard":
                heard += 1
                print(f"   heard {m['text']!r}  wake={m['wake']} armed={m['armed']}")
        while True:  # after the last utterance: a result (then idle) or just a state
            m = ws.receive_json()
            if m["type"] == "result":
                print(f"   RESULT ok={m['ok']} {m['action']} {m['zones']} {[c['name'] for c in m['commands']]} {m['reason'] or ''}")
            elif m["type"] == "state":
                print(f"   state {m['state']}")
                if m["state"] in ("idle", "awake"):
                    break
