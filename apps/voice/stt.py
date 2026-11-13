"""Speech-to-text models: which ones there are, which is in use, downloading them ahead of time.

The choice is kept in `<VOICE_DATA>/settings.json` (the /models volume), so it survives restarts and is made in the admin
page (/admin.html). Until someone chooses, VOICE_MODEL (default "small") decides. Two kinds of engine:

* `whisper`: faster-whisper (CTranslate2, int8, CPU), models from Hugging Face. Downloaded into HF_HOME; `download` fetches
  one ahead of time so the first spoken command doesn't wait on a gigabyte.
* `mistral`: Voxtral through Mistral's transcription API. Nothing to download, but the audio leaves the house and it needs
  MISTRAL_API_KEY. (Voxtral's open weights are 3B+ parameters: not something an N100 transcribes in time.)
"""
from __future__ import annotations

import io
import json
import logging
import os
import shutil
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("voice.stt")

DATA = Path(os.environ.get("VOICE_DATA", "/models"))
SETTINGS = DATA / "settings.json"
# What faster-whisper itself downloads for a model; the same patterns make `download` and WhisperModel share the cache.
PATTERNS = ["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"]
MISTRAL_URL = os.environ.get("VOICE_MISTRAL_URL", "https://api.mistral.ai/v1/audio/transcriptions")


@dataclass(frozen=True)
class Option:
    id: str
    label: str
    engine: str  # "whisper" | "mistral"
    repo: str = ""  # Hugging Face repository of a whisper model
    size_mb: int = 0
    note: str = ""

    @property
    def cloud(self) -> bool:
        return self.engine == "mistral"


# Multilingual only (the speech is Dutch). Sizes are the download; at run time they are int8, so about half that in RAM.
OPTIONS: list[Option] = [
    Option("tiny", "Whisper tiny", "whisper", "Systran/faster-whisper-tiny", 75, "Fastest, but often wrong in Dutch."),
    Option("base", "Whisper base", "whisper", "Systran/faster-whisper-base", 145, "Fast; the first thing to try on an N100."),
    Option("small", "Whisper small", "whisper", "Systran/faster-whisper-small", 484, "The default: good Dutch, several seconds per command on an N100."),
    Option("medium", "Whisper medium", "whisper", "Systran/faster-whisper-medium", 1530, "Accurate, too slow for a small CPU."),
    Option("large-v3-turbo", "Whisper large-v3 turbo", "whisper", "mobiuslabsgmbh/faster-whisper-large-v3-turbo", 1620,
           "Near large quality with a four-layer decoder; still heavy on a small CPU."),
    Option("large-v3", "Whisper large-v3", "whisper", "Systran/faster-whisper-large-v3", 3090, "Best Whisper quality; needs a fast CPU."),
    Option("voxtral", "Mistral Voxtral (cloud)", "mistral", "", 0,
           "Mistral's transcription API: fast and good in Dutch, but the audio is sent to Mistral and it needs MISTRAL_API_KEY."),
]


def mistral_model() -> str:
    return os.environ.get("VOICE_MISTRAL_MODEL", "voxtral-mini-latest")


def mistral_key() -> str:
    return os.environ.get("MISTRAL_API_KEY", "").strip()


def wav_bytes(audio) -> bytes:
    """16 kHz mono float32 -> a WAV file, for APIs that take uploads."""
    import numpy as np

    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm)
    return out.getvalue()


def multipart(fields: dict[str, str], file_name: str, file_bytes: bytes, content_type: str) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    body = io.BytesIO()
    for k, v in fields.items():
        body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\n'
               f"Content-Type: {content_type}\r\n\r\n".encode())
    body.write(file_bytes)
    body.write(f"\r\n--{boundary}--\r\n".encode())
    return body.getvalue(), f"multipart/form-data; boundary={boundary}"


class Unavailable(Exception):
    """The chosen engine can't transcribe right now (no key, model not downloaded, API down)."""


class Manager:
    def __init__(self, default: str | None = None):
        self._lock = threading.RLock()
        self._default = default or os.environ.get("VOICE_MODEL", "small")
        self._selected = self._load().get("model") or self._default
        self._loaded: tuple[str, object] | None = None  # (option id, WhisperModel)
        self._jobs: dict[str, dict] = {}  # option id -> {"done", "total", "error", "running"}
        self.last_ms: dict[str, int] = {}

    # -- settings ---------------------------------------------------------------------------------------------
    @staticmethod
    def _load() -> dict:
        try:
            return json.loads(SETTINGS.read_text())
        except (OSError, ValueError):
            return {}

    def _save(self) -> None:
        try:
            DATA.mkdir(parents=True, exist_ok=True)
            tmp = SETTINGS.with_suffix(".tmp")
            tmp.write_text(json.dumps({"model": self._selected}))
            tmp.replace(SETTINGS)
        except OSError as e:
            raise Unavailable(f"could not save the choice in {SETTINGS}: {e}") from e

    # -- options ----------------------------------------------------------------------------------------------
    def options(self) -> list[Option]:
        """The built-in ones, plus VOICE_MODEL / a saved choice that isn't among them (any faster-whisper size or repository)."""
        out = list(OPTIONS)
        if self._selected not in {o.id for o in out}:
            out.append(Option(self._selected, f"Custom: {self._selected}", "whisper", self._selected, 0, "Set through VOICE_MODEL."))
        return out

    def option(self, id: str) -> Option:
        for o in self.options():
            if o.id == id:
                return o
        raise KeyError(id)

    @property
    def selected(self) -> str:
        return self._selected

    @staticmethod
    def _cache_dir(opt: Option) -> Path:
        from huggingface_hub import constants

        return Path(constants.HF_HUB_CACHE) / ("models--" + opt.repo.replace("/", "--"))

    def installed(self, opt: Option) -> bool:
        if opt.engine == "mistral":
            return True
        if Path(opt.repo).is_dir():
            return True
        return self._complete(opt)

    def _complete(self, opt: Option) -> bool:
        """Whether every file faster-whisper needs is in the cache (an interrupted download leaves .incomplete blobs only)."""
        snaps = self._cache_dir(opt) / "snapshots"
        try:
            return any((s / "model.bin").exists() and (s / "config.json").exists() for s in snaps.iterdir())
        except OSError:
            return False

    def available(self, opt: Option) -> tuple[bool, str]:
        if opt.engine == "mistral":
            return (True, "") if mistral_key() else (False, "MISTRAL_API_KEY is not set on the voice service")
        return (True, "") if self.installed(opt) else (False, "not downloaded yet")

    def state(self) -> dict:
        with self._lock:
            rows = []
            for o in self.options():
                job = self._jobs.get(o.id) or {}
                ok, why = self.available(o)
                rows.append({
                    "id": o.id, "label": o.label, "engine": o.engine, "cloud": o.cloud, "note": o.note,
                    "size_mb": o.size_mb, "installed": self.installed(o), "usable": ok, "unavailable": why,
                    "selected": o.id == self._selected,
                    "downloading": bool(job.get("running")),
                    "progress": (job["done"] / job["total"]) if job.get("total") else (0.0 if job.get("running") else None),
                    "error": job.get("error"),
                    "last_ms": self.last_ms.get(o.id),
                })
            return {"selected": self._selected, "options": rows}

    # -- choosing ---------------------------------------------------------------------------------------------
    def select(self, id: str) -> None:
        with self._lock:
            opt = self.option(id)  # KeyError for an unknown one
            ok, why = self.available(opt)
            if not ok:
                raise Unavailable(f"{opt.label}: {why}")
            self._selected = id
            self._save()
            self._loaded = None  # the next command loads it (a model in use stays alive until its transcription ends)

    # -- downloading ------------------------------------------------------------------------------------------
    def download(self, id: str) -> None:
        """Start fetching a whisper model in the background; progress shows in state()."""
        with self._lock:
            opt = self.option(id)
            if opt.engine != "whisper":
                raise Unavailable(f"{opt.label} has nothing to download")
            if any(j.get("running") for j in self._jobs.values()):
                raise Unavailable("another download is running")
            self._jobs[id] = {"running": True, "done": 0, "total": 0, "error": None}
        threading.Thread(target=self._download, args=(opt,), daemon=True, name=f"download-{id}").start()

    def _download(self, opt: Option) -> None:
        from huggingface_hub import snapshot_download
        from huggingface_hub.utils import tqdm as hf_tqdm

        job = self._jobs[opt.id]
        lock = self._lock

        class Progress(hf_tqdm):  # the byte bars of the individual files; the "Fetching N files" bar counts items
            def __init__(self, *a, **kw):
                super().__init__(*a, **kw)
                if self.unit == "B":
                    with lock:
                        job["total"] += self.total or 0

            def update(self, n=1):
                out = super().update(n)
                if self.unit == "B":
                    with lock:
                        job["done"] += n
                return out

        try:
            t = time.time()
            snapshot_download(opt.repo, allow_patterns=PATTERNS, tqdm_class=Progress)
            log.info("downloaded %s in %.0fs", opt.id, time.time() - t)
            with lock:
                job.update(running=False, error=None, done=job["total"])
        except Exception as e:  # network, disk, permissions: shown on the page
            log.warning("download of %s failed: %s", opt.id, e)
            with lock:
                job.update(running=False, error=str(e) or type(e).__name__)

    def delete(self, id: str) -> None:
        with self._lock:
            opt = self.option(id)
            if opt.engine != "whisper" or Path(opt.repo).is_dir():
                raise Unavailable("nothing to delete")
            if id == self._selected:
                raise Unavailable("it is the model in use")
            if self._jobs.get(id, {}).get("running"):
                raise Unavailable("it is downloading")
            shutil.rmtree(self._cache_dir(opt), ignore_errors=True)
            self._jobs.pop(id, None)

    # -- transcribing -----------------------------------------------------------------------------------------
    def _whisper(self, opt: Option):
        if self._loaded is None or self._loaded[0] != opt.id:
            from faster_whisper import WhisperModel

            threads = int(os.environ.get("VOICE_THREADS", "0"))  # 0: CTranslate2 picks; the N100 has 4 cores
            t = time.time()
            try:
                model = WhisperModel(opt.repo, device="cpu", compute_type="int8", cpu_threads=threads)
            except Exception as e:
                raise Unavailable(f"{opt.label} could not be loaded: {e}") from e
            self._loaded = (opt.id, model)
            log.info("loaded whisper %s (threads=%s) in %.1fs", opt.id, threads or "auto", time.time() - t)
        return self._loaded[1]

    def transcribe(self, audio, prompt: str) -> str:
        """Callers serialise this (one transcription at a time)."""
        with self._lock:
            opt = self.option(self._selected)
        t = time.time()
        if opt.engine == "mistral":
            text = self._mistral(audio)
        else:
            if not self.installed(opt):
                log.warning("%s is not downloaded; fetching it now (use the admin page to do this ahead of time)", opt.id)
            segments, _ = self._whisper(opt).transcribe(
                audio, language="nl", initial_prompt=prompt, beam_size=1, vad_filter=True, condition_on_previous_text=False
            )
            text = " ".join(s.text.strip() for s in segments).strip()
        self.last_ms[opt.id] = round((time.time() - t) * 1000)
        return text

    @staticmethod
    def _mistral(audio) -> str:
        key = mistral_key()
        if not key:
            raise Unavailable("MISTRAL_API_KEY is not set on the voice service")
        body, ctype = multipart({"model": mistral_model(), "language": "nl"}, "command.wav", wav_bytes(audio), "audio/wav")
        req = urllib.request.Request(MISTRAL_URL, data=body, method="POST",
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": ctype})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return (json.load(r).get("text") or "").strip()
        except urllib.error.HTTPError as e:
            raise Unavailable(f"Mistral answered {e.code}") from e
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            raise Unavailable(f"Mistral could not be reached: {e}") from e
