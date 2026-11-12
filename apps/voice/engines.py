"""Intent engines. Each takes a transcript and returns a matcher.Result.

rules           deterministic Dutch grammar (tier 1)
needle          Cactus Needle 3 picks the action; the room is read from the transcript (uv sync --extra needle)
functiongemma   FunctionGemma 270M, same contract (uv sync --extra model, HF token + licence)
hybrid-<model>  rules first, that model only when the rules find no action

Voice exposes rooms and actions (lights on/off/dim, warmer, colder). A model only ever chooses the action and a
value; the room and the devices come from Matcher.resolve, so it cannot reach anything outside the catalog.
"""
from __future__ import annotations

import os
import re
import time

import timer

from dutch import canon
from matcher import OFF_WORDS, ON_WORDS, Matcher, Result, direction, has_light_word, norm, parse_number

MODEL_ID = os.environ.get("VOICE_FG_MODEL", "google/functiongemma-270m-it")

# Slot-extraction tools for FunctionGemma. (Needle's are defined as plain functions in Needle.load.)
TOOLS = [
    {"type": "function", "function": {
        "name": "set_lights", "description": "Zet de lichten in een ruimte aan of uit.",
        "parameters": {"type": "object", "properties": {
            "room": {"type": "string", "description": "De ruimte, zoals gezegd"},
            "on": {"type": "string", "description": "true om aan te zetten, false om uit te zetten"}},
            "required": ["room", "on"]}}},
    {"type": "function", "function": {
        "name": "dim_lights", "description": "Dim de lichten in een ruimte naar een percentage.",
        "parameters": {"type": "object", "properties": {
            "room": {"type": "string", "description": "De ruimte, zoals gezegd"},
            "percent": {"type": "string", "description": "Helderheid 0-100"}},
            "required": ["room", "percent"]}}},
    {"type": "function", "function": {
        "name": "adjust_temperature", "description": "Maak een ruimte warmer of kouder.",
        "parameters": {"type": "object", "properties": {
            "room": {"type": "string", "description": "De ruimte, zoals gezegd"},
            "warmer": {"type": "string", "description": "true voor warmer, false voor kouder"}},
            "required": ["room", "warmer"]}}},
]

_CALL = re.compile(r"<start_function_call>call:(\w+)\{(.*?)\}<end_function_call>", re.S)
_ARG = re.compile(r"(\w+):<escape>(.*?)<escape>", re.S)


def _truthy(s) -> bool:
    if isinstance(s, bool):
        return s
    return str(s).strip().lower() in {"true", "1", "yes", "ja", "aan", "open", "warmer"}


class FunctionGemma:
    def __init__(self):
        self._proc = self._model = None

    def load(self):
        if self._model is None:
            try:
                from transformers import AutoModelForCausalLM, AutoProcessor
            except ImportError as e:
                raise RuntimeError("transformers ontbreekt: draai `uv sync --extra model`") from e
            try:
                self._proc = AutoProcessor.from_pretrained(MODEL_ID)
                self._model = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype="auto")
            except Exception as e:  # gated repo / no token / offline
                raise RuntimeError(f"kon {MODEL_ID} niet laden (HF-token + licentie nodig?): {e}") from e
        return self._proc, self._model

    def extract(self, text: str) -> tuple[str, dict] | None:
        proc, model = self.load()
        msgs = [
            {"role": "developer", "content": "You are a model that can do function calling with the following functions"},
            {"role": "user", "content": text},
        ]
        inputs = proc.apply_chat_template(msgs, tools=TOOLS, add_generation_prompt=True,
                                          return_dict=True, return_tensors="pt")
        out = model.generate(**inputs.to(model.device), pad_token_id=proc.eos_token_id, max_new_tokens=96, do_sample=False)
        raw = proc.decode(out[0][len(inputs["input_ids"][0]):], skip_special_tokens=False)
        m = _CALL.search(raw)
        return (m.group(1), dict(_ARG.findall(m.group(2)))) if m else None


class Needle:
    """Cactus Needle 3 (cactus-compute>=4, ~190 MB RAM, ~40 ms/query on a laptop CPU). Weights come from the public
    Cactus-Compute/needle3 repo on Hugging Face on first use, then it runs fully offline. Needle 2 needs the
    legacy cactus-compute<4 branch; the current package only loads Needle 3."""

    def __init__(self):
        self._agent = None

    def load(self):
        if self._agent is None:
            os.environ.setdefault("CACTUS_TELEMETRY", "0")  # in-house: no usage pings
            try:
                import cactus
            except ImportError as e:
                raise RuntimeError("cactus-compute ontbreekt: draai `uv sync --extra needle`") from e

            def set_lights(room: str, on: bool):
                "Zet de lichten in een ruimte aan (on=true) of uit (on=false)."

            def dim_lights(room: str, percent: int):
                "Dim de lichten in een ruimte naar een percentage helderheid."

            def adjust_temperature(room: str, warmer: bool):
                "Maak een ruimte warmer (warmer=true) of kouder (warmer=false)."

            # Tried separate make_warmer/make_colder tools (6/9 vs 7/9) and a 4th adjust_light_color tool (6/13): more tools make
            # Needle worse. Light colour vs heating is decided from the sentence (light word), see _to_intent.
            tools = [cactus.tool(f) for f in (set_lights, dim_lights, adjust_temperature)]
            self._agent = cactus.Cactus(tools=tools, stateless=True)
        return self._agent

    def extract(self, text: str) -> tuple[str, dict] | None:
        out = self.load().complete(text)
        # Low-confidence calls land in suppressed_calls; still usable because the plausibility + catalog guards follow.
        calls = out.get("function_calls") or out.get("suppressed_calls") or []
        return (calls[0]["name"], calls[0]["arguments"]) if calls else None


_fg, _needle = FunctionGemma(), Needle()


def _to_intent(name: str, a: dict, tokens: list[str] | None = None) -> tuple[str, object]:
    """Model call -> (action, value). "warmer" is the light's colour when the sentence is about the light."""
    if name == "set_lights":
        return ("lights_on" if _truthy(a.get("on", "")) else "lights_off"), None
    if name == "dim_lights":
        return "lights_dim", float(re.sub(r"[^\d.]", "", str(a["percent"]))) / 100
    if name == "make_warmer":
        return "warmer", None
    if name == "make_colder":
        return "colder", None
    if name == "adjust_temperature":
        up = _truthy(a.get("warmer", ""))
        if tokens is not None and has_light_word(tokens):
            return ("lights_warmer" if up else "lights_cooler"), None
        return ("warmer" if up else "colder"), None
    raise ValueError(f"onbekende functie {name}")


def plausible(action: str, tokens: list[str]) -> bool:
    """Tiny models sometimes pick the wrong function ('doe het licht uit' -> dim 50%). Only accept an answer the
    words themselves support: dim needs a number, on/off an aan/uit word, and a warmer/colder answer must go the
    way the words say (and be about the light colour only when a light word is present)."""
    t = set(tokens)
    if action in {"lights_warmer", "lights_cooler", "warmer", "colder"}:
        want = 1 if action in {"lights_warmer", "warmer"} else -1
        return direction(tokens) == want and has_light_word(tokens) == action.startswith("lights_")
    return {
        "lights_on": bool(t & ON_WORDS),
        "lights_off": bool(t & OFF_WORDS),
        "lights_dim": parse_number(tokens) is not None,
    }.get(action, False)


def _run_model(model, matcher: Matcher, text: str, zone: str | None) -> Result:
    t = time.time()
    try:
        call = model.extract(canon(text))
        if call is None:
            return Result(False, text, "model deed geen functieaanroep")
        action, value = _to_intent(*call, norm(text).split())
    except (RuntimeError, ValueError, KeyError) as e:
        return Result(False, text, str(e))
    if not plausible(action, norm(text).split()):
        r = Result(False, text, f"model koos {action}, maar dat staat niet in de zin", action=action)
    else:
        r = matcher.resolve(text, action, value, zone)
    r.model_ms = round((time.time() - t) * 1000)
    return r


ENGINES = {
    "needle": lambda m, t, z: _run_model(_needle, m, t, z),
    "functiongemma": lambda m, t, z: _run_model(_fg, m, t, z),
}


def run(engine: str, matcher: Matcher, text: str, zone: str | None = None) -> tuple[Result, str]:
    """Returns (result, engine actually used). The room is always filled in, also when the command failed."""
    if (t := timer.parse(text)) is not None:  # a timer is not about any room or device, so no engine is asked
        seconds, name, reason = t
        return Result(reason is None, text, reason, action="timer", value={"seconds": seconds, "name": name}), "rules"
    r, used = _run(engine, matcher, text, zone)
    r.zones = r.zones or matcher.rooms(text) or ([matcher.zone(zone)] if zone else [])
    return r, used


def _run(engine: str, matcher: Matcher, text: str, zone: str | None) -> tuple[Result, str]:
    if engine == "rules":
        return matcher.match(text, zone), "rules"
    if engine in ENGINES:
        return ENGINES[engine](matcher, text, zone), engine
    if engine.startswith("hybrid-"):  # rules first, the named model only when rules fail
        r = matcher.match(text, zone)
        if r.ok:
            return r, "rules"
        model = engine.removeprefix("hybrid-")
        return ENGINES[model](matcher, text, zone), f"{model} (rules faalden)"
    raise ValueError(f"onbekende engine {engine}")
