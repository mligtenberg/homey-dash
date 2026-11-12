"""STT+matcher eval on spoken commands. `uv run python eval.py <dir> [engine]`

Needs <dir>/*.wav plus <dir>/expected.json: {"file.wav": [action, value, [device ids]]}.
Generate a synthetic set (macOS, Dutch voice): `uv run python eval.py --synth tmp-eval`
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import engines
from app import get_matcher, transcribe

PHRASES = {  # transcript -> [action, value, zones-or-None, device ids]
    "zet de lichten in de woonkamer aan": ["lights_on", None, ["d1", "d2"]],
    "doe het licht in de keuken uit": ["lights_off", None, ["d4"]],
    "dim de lichten in de woonkamer naar vijftig procent": ["lights_dim", 0.5, ["d1", "d2"]],
    "dim de lichten in de keuken naar dertig procent": ["lights_dim", 0.3, ["d4"]],
    "maak het warmer in de slaapkamer": ["warmer", None, ["d10"]],
    "maak het kouder in de woonkamer": ["colder", None, ["d6"]],
    "alle lichten uit": ["lights_off", None, ["d1", "d2", "d3", "d4", "d8", "d9"]],
    "lichten in de slaapkamer aan": ["lights_on", None, ["d3"]],
    "kouder in de keuken": ["colder", None, ["d11"]],
    "het licht in de woonkamer is te koud": ["lights_warmer", None, ["d1", "d2"]],
    "de lampen in de woonkamer zijn te warm": ["lights_cooler", None, ["d1", "d2"]],
    "het is te koud in de slaapkamer": ["warmer", None, ["d10"]],
    "het is te warm in de keuken": ["colder", None, ["d11"]],
}


def synth(out: Path) -> None:
    out.mkdir(exist_ok=True)
    exp = {}
    for i, (text, want) in enumerate(PHRASES.items()):
        name = f"{i:02d}.wav"
        subprocess.run(["say", "-v", "Xander", "-o", str(out / name), "--data-format=LEI16@16000", text], check=True)
        exp[name] = want
    (out / "expected.json").write_text(json.dumps(exp, indent=1))


def run(d: Path, engine: str) -> None:
    exp = json.loads((d / "expected.json").read_text())
    right = 0
    for name, want in exp.items():
        t = time.time()
        text = transcribe(str(d / name))
        zone = None
        ms = (time.time() - t) * 1000
        r, _ = engines.run(engine, get_matcher(), text, zone)
        got = [r.action, r.value, sorted(c["device"] for c in r.commands)] if r.ok else None
        good = got == want
        right += good
        print(f"{'OK ' if good else 'BAD'} {ms:5.0f}ms  {text!r}  ->  {got or r.reason}")
    print(f"\n{right}/{len(exp)} correct")


if __name__ == "__main__":
    if sys.argv[1:2] == ["--synth"]:
        synth(Path(sys.argv[2]))
    else:
        run(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else "rules")
