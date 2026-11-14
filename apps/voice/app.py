"""Voice PoC server. Run: uv run uvicorn app:app --port 8765

POST /api/voice  multipart `audio` (any ffmpeg-readable format) -> transcript + matched command
POST /api/text   {"text": "..."}                                -> matched command (skips STT)
The service never talks to Homey: it logs and returns the commands (device, capability, value; `*_delta` capabilities
are steps from the current value), and the display that heard them carries them out through HomeyDash.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import threading
import time
from pathlib import Path

import numpy as np

from fastapi import FastAPI, Request, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from catalog import CatalogSource, CatalogUnavailable
from matcher import Matcher, Result, norm
import engines
import stt
import timer
import wake
from wakeword import WakeWord

HERE = Path(__file__).parent
log = logging.getLogger("voice")
logging.basicConfig(level=logging.INFO)

# Rooms and devices come from HomeyDash (the dev API unless HOMEY_DASH_URL says otherwise), never from a stand-in.
source = CatalogSource(os.environ.get("HOMEY_DASH_URL", "http://localhost:5112"))
_matcher: tuple[dict, Matcher] | None = None


def get_matcher() -> Matcher:
    """The matcher for the current catalog (rebuilt only when the catalog changed)."""
    global _matcher
    cat = source.get()
    if _matcher is None or _matcher[0] != cat:
        _matcher = (cat, Matcher(cat))
    return _matcher[1]

# A sentence that ends on one of these, or is a timer without a length, is not finished: the speaker paused to think.
DANGLING = {"voor", "van", "op", "naar", "met", "in", "een", "de", "het", "en", "tot", "om", "over", "na", "bij"}
RATE_GAP = 3200  # 0.2 s of silence between the two halves
WAKE_THRESHOLD = 0.5
PREROLL_BYTES = 16000 * 2 * 2  # two seconds of int16
HOLD_S = 5.0  # how long a half sentence waits for the rest


def unfinished(command: str) -> bool:
    tokens = norm(command).split()
    if not tokens:
        return False
    parsed = timer.parse(command)
    return tokens[-1] in DANGLING or (parsed is not None and parsed[0] == 0)


def run_command(engine: str, text: str, zone: str | None):
    """The command's result; a refusal when HomeyDash can't be asked what rooms and devices there are."""
    try:
        return engines.run(engine, get_matcher(), text, zone)
    except CatalogUnavailable:
        return Result(False, text, "Homey is niet bereikbaar", zones=[zone] if zone else []), engine


WAKE = os.environ.get("VOICE_WAKE", "homey,homie,homi")

def prompt(wake_words: str = WAKE) -> str:
    """Bias Whisper towards our vocabulary: it is a closed set of words and this helps a lot.
    It opens with the wake phrase as it is spoken (the screens say "hey jarvis", not VOICE_WAKE), or Whisper spells it
    its own way. No number in it may sound like the start of another: with "vijftig procent" in here, "een timer van
    vijf seconden" came out as "voor vijftig seconden"."""
    try:
        zones = source.get()["zones"]
    except CatalogUnavailable:
        zones = []
    return (wake_words.split(",")[0].strip().title() + ", zet de lichten aan. Commando's voor het huis: "
            + ", ".join(sorted(set(zones)))
            + ". Zet de lichten in de woonkamer aan. Doe het licht uit. Dim de lichten naar dertig procent."
              " Maak het warmer. Het licht is te koud."
              " Zet een timer voor vijf seconden. Zet een timer voor tien minuten. Stop de timer.")


models = stt.Manager()


def decode(path: str):
    """Any container -> 16 kHz mono float32, via the ffmpeg binary (PyAV's API drifts between releases)."""
    import numpy as np
    import subprocess

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


_stt_lock = threading.Lock()  # one transcription at a time; the model is not thread-safe


def transcribe(path: str) -> str:
    return transcribe_audio(decode(path))


def transcribe_audio(audio, bias: str | None = None) -> str:
    with _stt_lock:
        return _transcribe(audio, bias)


def _transcribe(audio, bias: str | None = None) -> str:
    return models.transcribe(audio, prompt() if bias is None else bias)


app = FastAPI()


class Text(BaseModel):
    text: str


@app.post("/api/wake")
async def wake_test(request: Request):
    """The wake word over a recording (16 kHz int16 PCM as the body): the best score, when it came (s) and the time it took."""
    pcm = await request.body()
    t0 = time.time()
    det, best, at = WakeWord(), 0.0, 0.0
    for i in range(0, len(pcm) - 2559, 2560):  # 1280 samples at a time
        if (s := det.feed(pcm[i:i + 2560])) > best:
            best, at = s, i / 32000
    return {"score": best, "at": at, "ms": round((time.time() - t0) * 1000)}


class Choice(BaseModel):
    id: str


def _stt_call(fn, *args):
    try:
        return fn(*args)
    except KeyError:
        raise HTTPException(404, "unknown model")
    except stt.Unavailable as e:
        raise HTTPException(409, str(e))


@app.get("/api/stt")
def stt_state():
    """The speech-to-text models: which one is in use, which are downloaded (or downloading, with progress)."""
    return models.state()


@app.post("/api/stt/select")
def stt_select(body: Choice):
    _stt_call(models.select, body.id)
    return models.state()


@app.post("/api/stt/{model_id}/download", status_code=202)
def stt_download(model_id: str):
    _stt_call(models.download, model_id)
    return models.state()


@app.delete("/api/stt/{model_id}")
def stt_delete(model_id: str):
    _stt_call(models.delete, model_id)
    return models.state()


@app.get("/api/catalog")
def get_catalog():
    try:
        return source.get()
    except CatalogUnavailable:
        raise HTTPException(503, "HomeyDash is not reachable")


@app.post("/api/text")
def text(body: Text, engine: str = "rules", zone: str | None = None):
    res, used = run_command(engine, body.text, zone)
    r = res.to_dict()
    r["engine"] = used
    log.info("text %r -> %s", body.text, r["reason"] or (r["action"], r["value"], r["zones"]))
    return r


@app.post("/api/voice")
async def voice(audio: UploadFile, engine: str = "rules", zone: str | None = None):
    suffix = Path(audio.filename or "a.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(await audio.read())
    try:
        t0 = time.time()
        transcript = transcribe(f.name)
        t1 = time.time()
    except stt.Unavailable as e:
        raise HTTPException(503, str(e))
    finally:
        os.unlink(f.name)
    res, used = run_command(engine, transcript, zone)
    r = res.to_dict()
    r["engine"] = used
    r["timing_ms"] = {"stt": round((t1 - t0) * 1000), "match": round((time.time() - t1) * 1000)}
    log.info("voice %r -> %s %s", transcript, r["reason"] or (r["action"], r["value"], r["zones"]), r["timing_ms"])
    return r


# A memo is free speech, so unlike a command it gets no vocabulary to lean on; this only tells Whisper it is Dutch prose.
MEMO_PROMPT = "Dit is een gesproken notitie in het Nederlands."


@app.post("/api/transcribe")
async def memo(audio: UploadFile):
    """A voice memo: the Dutch text of a recording, with no command matching. Returns {text, ms}."""
    suffix = Path(audio.filename or "a.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(await audio.read())
    try:
        t0 = time.time()
        pcm = await asyncio.to_thread(decode, f.name)
        text = await asyncio.to_thread(transcribe_audio, pcm, MEMO_PROMPT)
    except stt.Unavailable as e:
        raise HTTPException(503, str(e))
    except Exception as e:  # ffmpeg could not read the recording
        log.warning("memo could not be read: %s", e)
        raise HTTPException(422, "the recording could not be read")
    finally:
        os.unlink(f.name)
    ms = round((time.time() - t0) * 1000)
    log.info("memo %d chars in %d ms", len(text), ms)
    return {"text": text, "ms": ms}


@app.websocket("/ws/listen")
async def listen(ws: WebSocket, engine: str = "rules", zone: str | None = None, wake_words: str | None = Query(None, alias="wake"), detect: bool = False):
    """Continuous listening. Client sends 16 kHz mono int16 PCM; server sends JSON events:
    state(idle|speech|awake|thinking), heard(text, wake), result(...).
    `wake` overrides the spoken wake phrase (comma-separated spellings). A client that detects the wake word itself
    (openWakeWord in the page) sends {"type": "arm"} first; the next utterance is then a command, wake phrase or not.
    With `detect`, the client is too slow for that and streams everything: openWakeWord runs here, and only after it
    fires does the audio (with the last two seconds before it) go to the segmenter and Whisper."""
    phrase = wake_words or WAKE
    await ws.accept()
    seg, awake_until = wake.Segmenter(), 0.0
    held, held_until = None, 0.0
    last = None
    armed_speech = False  # whether what is being said began while awake
    detector = WakeWord() if detect else None
    if detect:
        log.info("listening with the wake word detected here")
    active = not detect  # false while the detector waits for the wake word
    ring = b""
    cool = 0.0

    async def state(s: str):
        nonlocal last
        if s != last:
            last = s
            await ws.send_json({"type": "state", "state": s, "wake": WAKE.split(",")[0]})

    await state("idle")
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("text"):
                if json.loads(msg["text"]).get("type") == "arm":
                    awake_until = time.time() + wake.AWAKE_S
                    await state("awake")
                continue
            pcm = msg.get("bytes") or b""
            if not active:
                ring = (ring + pcm)[-PREROLL_BYTES:]
                score = detector.feed(pcm)
                if score > 0.15 and score < WAKE_THRESHOLD:
                    log.info("wake score %.2f (needs %.2f)", score, WAKE_THRESHOLD)
                if score < WAKE_THRESHOLD or time.time() < cool:
                    continue
                log.info("wake word heard")
                active, pcm, ring = True, ring, b""
                seg, awake_until = wake.Segmenter(), time.time() + wake.AWAKE_S
                await state("awake")
            for utt in seg.feed(pcm):
                if held is not None and time.time() < held_until:  # the rest of a sentence that was paused in
                    utt = np.concatenate([held, np.zeros(RATE_GAP, np.float32), utt])
                held = None
                # Before transcribing: that takes seconds on a small CPU, and the window would run out meanwhile.
                armed, armed_speech = armed_speech or time.time() < awake_until, False
                await state("thinking")
                t0 = time.time()
                try:
                    text = await asyncio.to_thread(lambda: transcribe_audio(utt, prompt(phrase)))
                except stt.Unavailable as e:  # no key, model gone, API down: say so in the log, keep the socket
                    log.warning("transcription failed: %s", e)
                    text = ""
                stt_ms = round((time.time() - t0) * 1000)
                woke, rest = wake.split_wake(text, phrase)
                await ws.send_json({"type": "heard", "text": text, "wake": woke, "armed": armed, "stt_ms": stt_ms})
                if not (woke or armed):
                    await state("idle")
                elif not rest:  # bare wake phrase: the next utterance is the command
                    awake_until = time.time() + wake.AWAKE_S
                    await state("awake")
                elif unfinished(rest):  # cut off mid-sentence: keep the audio and wait for the rest
                    held, held_until = utt, time.time() + HOLD_S
                    awake_until = held_until
                    await state("awake")
                else:
                    awake_until = 0.0
                    res, used = run_command(engine, rest, zone)
                    r = res.to_dict()
                    r.update(engine=used, timing_ms={"stt": stt_ms}, command_text=rest)
                    log.info("listen %r -> %s", text, r["reason"] or (r["action"], r["value"], r["zones"]))
                    await ws.send_json({"type": "result", **r})
                    await state("idle")
            if seg.speaking:
                armed_speech = armed_speech or time.time() < awake_until
                await state("speech")
            elif time.time() < awake_until:
                await state("awake")
            elif last == "awake":
                await state("idle")
            if detector and active and not seg.speaking and held is None and time.time() >= awake_until:
                active, cool = False, time.time() + 1.5
                detector.reset()
                await state("idle")
    except WebSocketDisconnect:
        pass


# Static assets (wake word models, onnxruntime-web, wakeword.js). Last, so the routes above win.
app.mount("/", StaticFiles(directory=HERE / "static"), name="static")
