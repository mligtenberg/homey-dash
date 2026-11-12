"""Deterministic Dutch command matcher: transcript -> {zones, action, value, commands}.

Voice exposes rooms and a handful of actions, not individual devices:
    lichten aan | lichten uit | lichten dim N% | warmer | kouder
A command is "<action> in <room>"; no room spoken -> the room the display is in; "overal" -> every room.
Every command expands to real catalog devices of that room and kind, so nothing outside the catalog is touched.
Engines (rules or a model) only decide the action; the room is always read from the transcript.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field, asdict

from rapidfuzz import fuzz

TEMP_STEP = 1.0  # degrees per "warmer"/"kouder" (heating)
# Light colour temperature step per "warmer"/"koeler" licht. Sign convention of the command: + = warmer tone,
# - = cooler tone. Whoever executes it maps that onto Homey's light_temperature axis (not verified here).
LIGHT_TONE_STEP = 0.2

NUMBER_WORDS = {
    "nul": 0, "een": 1, "twee": 2, "drie": 3, "vier": 4, "vijf": 5, "zes": 6, "zeven": 7,
    "acht": 8, "negen": 9, "tien": 10, "elf": 11, "twaalf": 12, "dertien": 13, "veertien": 14,
    "vijftien": 15, "zestien": 16, "zeventien": 17, "achttien": 18, "negentien": 19,
    "twintig": 20, "dertig": 30, "veertig": 40, "vijftig": 50, "zestig": 60, "zeventig": 70,
    "tachtig": 80, "negentig": 90, "honderd": 100,
}
LIGHT_WORDS = {"licht", "lichten", "lamp", "lampen", "verlichting"}
ON_WORDS = {"aan", "aanzetten", "aandoen", "aanschakelen", "aanmaken"}
OFF_WORDS = {"uit", "uitzetten", "uitdoen", "uitschakelen", "uitmaken", "dooft"}
WARMER_WORDS = {"warmer", "verwarm"}
COLDER_WORDS = {"kouder", "koeler"}
TOO_COLD = {"koud", "kil", "fris", "koel", "blauw", "blauwig"}   # "het licht is te koud" -> wants warmer
TOO_WARM = {"warm", "heet", "geel", "gelig", "oranje"}          # "het is te warm"       -> wants colder
EVERYWHERE = {"overal", "alle", "allemaal", "huis"}
OTHER_SUBJECTS = {"verwarming", "thermostaat", "gordijn", "rolgordijn", "wasmachine", "radiator"}

ACTIONS = ("lights_on", "lights_off", "lights_dim", "lights_warmer", "lights_cooler", "warmer", "colder")


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("%", " procent ")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


COMPLAINT_WORDS = {"te", "is", "zijn", "wordt", "erg", "zo", "echt", "vind"}
REQUEST_VERBS = {"maak", "zet", "doe"}


def direction(tokens: list[str]) -> int | None:
    """Which way does the speaker want it: +1 warmer, -1 colder; None if unclear.
    Comparatives are requests ("maak het warmer"). A plain adjective is a complaint when the sentence says so
    ("het is te koud" -> warmer) and a literal request after a verb ("maak het koud" -> colder). A bare "koud in de
    keuken" is ambiguous (STT often clips "kouder" to "koud"), so it is left undecided."""
    t = set(tokens)
    if t & WARMER_WORDS:
        return 1
    if t & COLDER_WORDS:
        return -1
    cold, warm = bool(t & TOO_COLD), bool(t & TOO_WARM)
    if cold == warm:
        return None
    if t & COMPLAINT_WORDS:
        return 1 if cold else -1
    if t & REQUEST_VERBS:
        return -1 if cold else 1
    return None


def has_light_word(tokens: list[str]) -> bool:
    return any(x.endswith(tuple(LIGHT_WORDS)) for x in tokens)  # also compounds: keukenlamp, tuinverlichting


def squash(text: str) -> str:
    return norm(text).replace(" ", "")


def compound_number(t: str) -> int | None:
    """'eenentwintig' -> 21 (unit + 'en' + tens)."""
    for i in range(1, len(t) - 2):
        unit, tens = t[:i], t[i:]
        if tens.startswith("en") and unit in NUMBER_WORDS and tens[2:] in NUMBER_WORDS and NUMBER_WORDS[tens[2:]] >= 20:
            return NUMBER_WORDS[tens[2:]] + NUMBER_WORDS[unit]
    return None


def parse_number(tokens: list[str]) -> int | None:
    for t in tokens:
        if t.isdigit():
            return int(t)
    for t in tokens:
        if (n := compound_number(t)) is not None:
            return n
    total, seen = 0, False
    for t in tokens:
        if t in NUMBER_WORDS:
            total += NUMBER_WORDS[t]
            seen = True
    return total if seen else None


@dataclass
class Result:
    ok: bool
    transcript: str
    reason: str | None = None
    action: str | None = None
    value: object = None
    zones: list[str] = field(default_factory=list)
    commands: list[dict] = field(default_factory=list)  # what would be sent: {device, name, zone, capability, value}
    model_ms: int | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class Matcher:
    def __init__(self, catalog: dict):
        self.devices = catalog["devices"]
        self.zones = catalog["zones"]

    # -- action -----------------------------------------------------------------------------
    def intent(self, text: str) -> tuple[str | None, object, str | None]:
        """-> (action, value, reason-if-refused)"""
        tokens = norm(text).split()
        t = set(tokens)
        number = parse_number([x for x in tokens if x != "een"])
        light = has_light_word(tokens)
        if t & {"dim", "dimmen", "dimmer", "helderheid"} or ("procent" in t and number is not None):
            if number is None:
                return "lights_dim", None, "hoeveel procent?"
            return "lights_dim", min(number, 100) / 100, None
        if direction(tokens) is None and t & (TOO_COLD | TOO_WARM) and not t & (WARMER_WORDS | COLDER_WORDS):
            return None, None, "warmer of kouder?"
        if (d := direction(tokens)) is not None:
            # about the light ("het licht is te koud") -> light colour; otherwise the heating
            if light:
                return ("lights_warmer" if d > 0 else "lights_cooler"), None, None
            return ("warmer" if d > 0 else "colder"), None, None
        on, off = bool(t & ON_WORDS), bool(t & OFF_WORDS)
        if on != off:
            if t & OTHER_SUBJECTS and not light:
                return None, None, "alleen lichten en warmer/kouder zijn beschikbaar"
            if not light:
                return None, None, "bedoel je de lichten?"
            return ("lights_on" if on else "lights_off"), None, None
        return None, None, "geen actie herkend"

    # -- room -------------------------------------------------------------------------------
    def rooms(self, text: str) -> list[str]:
        """Rooms named in the transcript. Compounds and STT splits ('slaap kamer') still match."""
        tokens = norm(text).split()
        if set(tokens) & EVERYWHERE:
            return list(self.zones)
        windows = tokens + [a + b for a, b in zip(tokens, tokens[1:])]
        found = []
        for z in self.zones:
            zs = squash(z)
            if any(w == zs or (len(w) >= 5 and fuzz.ratio(w, zs) >= 85) for w in windows):
                found.append(z)
        return found

    # -- public -----------------------------------------------------------------------------
    def match(self, transcript: str, default_zone: str | None = None) -> Result:
        action, value, refused = self.intent(transcript)
        if action is None or refused:
            return Result(False, transcript, refused or "geen actie herkend", action=action)
        return self.resolve(transcript, action, value, default_zone)

    def zone(self, name: str | None) -> str | None:
        """The catalog's spelling of a zone a screen is in (Homey's names may differ in case); unknown ones as given."""
        return next((z for z in self.zones if z.casefold() == name.casefold()), name) if name else None

    def resolve(self, transcript: str, action: str, value, default_zone: str | None = None) -> Result:
        """Action is known (from rules or a model); find the room and the devices. Shared by every engine so a
        model can never reach a device outside the catalog."""
        if action not in ACTIONS:
            return Result(False, transcript, f"onbekende actie {action}")
        zones = self.rooms(transcript) or ([self.zone(default_zone)] if default_zone else [])
        if not zones:
            return Result(False, transcript, "welke ruimte?", action=action, value=value)
        if action == "lights_dim" and (value is None or not 0 <= value <= 1):
            return Result(False, transcript, "hoeveel procent?", action=action, value=value, zones=zones)

        kind = "thermostat" if action in {"warmer", "colder"} else "light"
        need = {"lights_on": "onoff", "lights_off": "onoff", "lights_dim": "dim", "lights_warmer": "light_temperature",
                "lights_cooler": "light_temperature"}.get(action, "target_temperature")
        commands = []
        for d in self.devices:
            if d["zone"] in zones and d["kind"] == kind and need in d["caps"]:
                cap, val = {
                    "lights_on": ("onoff", True), "lights_off": ("onoff", False), "lights_dim": ("dim", value),
                    "warmer": ("target_temperature_delta", TEMP_STEP), "colder": ("target_temperature_delta", -TEMP_STEP),
                    "lights_warmer": ("light_temperature_delta", LIGHT_TONE_STEP),
                    "lights_cooler": ("light_temperature_delta", -LIGHT_TONE_STEP),
                }[action]
                commands.append({"device": d["id"], "name": d["name"], "zone": d["zone"], "capability": cap, "value": val})
        if not commands:
            what = ("thermostaat" if kind == "thermostat" else "dimbare lichten" if action == "lights_dim"
                    else "lichten met instelbare kleur" if need == "light_temperature" else "lichten")
            return Result(False, transcript, f"geen {what} in {', '.join(zones)}", action=action, value=value, zones=zones)
        return Result(True, transcript, action=action, value=value, zones=zones, commands=commands)
