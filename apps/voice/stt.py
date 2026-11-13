"""Speech-to-text models: which ones there are, which is in use, downloading them ahead of time.

The choice is kept in `<VOICE_DATA>/settings.json` (the /models volume), so it survives restarts and is made in Management
page under Accounts. Until someone chooses, VOICE_MODEL (default "small") decides; it may also be a Hugging Face repository
of a CTranslate2 Whisper model (a fine-tune), which then shows up on the page. Models are faster-whisper (CTranslate2,
int8, CPU), downloaded into HF_HOME; `download` fetches one ahead of time so the first spoken command doesn't wait.
Only models that fit the 3 GB the container is given are offered.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("voice.stt")

DATA = Path(os.environ.get("VOICE_DATA", "/models"))
SETTINGS = DATA / "settings.json"
# What faster-whisper itself downloads for a model; the same patterns make `download` and WhisperModel share the cache.
PATTERNS = ["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"]


@dataclass(frozen=True)
class Option:
    id: str
    label: str
    repo: str  # Hugging Face repository of the CTranslate2 model, or a local directory
    size_mb: int = 0
    note: str = ""


# Multilingual only (the speech is Dutch). Sizes are the download; at run time they are int8, so about half that in RAM.
OPTIONS: list[Option] = [
    Option("tiny", "Whisper tiny", "Systran/faster-whisper-tiny", 75, "Fastest, but often wrong in Dutch."),
    Option("base", "Whisper base", "Systran/faster-whisper-base", 145, "Fast; the first thing to try on an N100."),
    Option("small", "Whisper small", "Systran/faster-whisper-small", 484, "The default: good Dutch, several seconds per command on an N100."),
    Option("medium", "Whisper medium", "Systran/faster-whisper-medium", 1530, "Accurate, about 1.7 GB of RAM and slow on a small CPU."),
]


class Unavailable(Exception):
    """The chosen model can't be used right now (not downloaded, can't be loaded, a download is running)."""


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
            out.append(Option(self._selected, f"Custom: {self._selected}", self._selected, 0, "Set through VOICE_MODEL."))
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
        return (True, "") if self.installed(opt) else (False, "not downloaded yet")

    def state(self) -> dict:
        with self._lock:
            rows = []
            for o in self.options():
                job = self._jobs.get(o.id) or {}
                ok, why = self.available(o)
                rows.append({
                    "id": o.id, "label": o.label, "note": o.note,
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
            if Path(opt.repo).is_dir():
                raise Unavailable(f"{opt.label} is a local directory")
            if any(j.get("running") for j in self._jobs.values()):
                raise Unavailable("another download is running")
            self._jobs[id] = {"running": True, "done": 0, "total": 0, "error": None}
        threading.Thread(target=self._download, args=(opt,), daemon=True, name=f"download-{id}").start()

    def _download(self, opt: Option) -> None:
        from huggingface_hub import snapshot_download
        from tqdm import tqdm as plain_tqdm

        job = self._jobs[opt.id]
        lock = self._lock
        sink = open(os.devnull, "w")

        class Progress(plain_tqdm):  # the byte bars of the individual files; the "Fetching N files" bar counts items
            def __init__(self, *a, **kw):
                # Plain tqdm, not huggingface's: without a terminal (a container) its bars are disabled, and tqdm then
                # skips setting `unit`. We only count bytes, so keep the bar on and print nothing.
                kw["disable"] = False
                kw["file"] = sink
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
        finally:
            sink.close()

    def delete(self, id: str) -> None:
        with self._lock:
            opt = self.option(id)
            if Path(opt.repo).is_dir():
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
        if not self.installed(opt):
            log.warning("%s is not downloaded; fetching it now (use the admin page to do this ahead of time)", opt.id)
        segments, _ = self._whisper(opt).transcribe(
            audio, language="nl", initial_prompt=prompt, beam_size=5, vad_filter=True, condition_on_previous_text=False
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        self.last_ms[opt.id] = round((time.time() - t) * 1000)
        return text
