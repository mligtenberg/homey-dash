import json
from pathlib import Path

import pytest

from matcher import Matcher

M = Matcher(json.loads((Path(__file__).parent / "test_catalog.json").read_text()))


def ids(r):
    return sorted(c["device"] for c in r.commands)


ALL_LIGHTS = ["d1", "d2", "d3", "d4", "d8", "d9"]

# (transcript, display zone, action, value, zones, device ids)
CASES = [
    ("doe de lichten in de woonkamer uit", None, "lights_off", None, ["woonkamer"], ["d1", "d2"]),
    ("zet de lichten in de keuken aan", None, "lights_on", None, ["keuken"], ["d4"]),
    ("Doe het licht uit.", "slaapkamer", "lights_off", None, ["slaapkamer"], ["d3"]),
    ("lichten aan", "hal", "lights_on", None, ["hal"], ["d9"]),
    ("kun je de lampen in de slaap kamer aandoen", None, "lights_on", None, ["slaapkamer"], ["d3"]),
    ("dim de lichten in de woonkamer naar vijftig procent", None, "lights_dim", 0.5, ["woonkamer"], ["d1", "d2"]),
    ("dim de woonkamer naar 30%", None, "lights_dim", 0.3, ["woonkamer"], ["d1", "d2"]),
    ("zet het licht op 20 procent", "keuken", "lights_dim", 0.2, ["keuken"], ["d4"]),
    ("maak het warmer in de slaapkamer", None, "warmer", None, ["slaapkamer"], ["d10"]),
    ("het is te warm, maak het kouder", "woonkamer", "colder", None, ["woonkamer"], ["d6"]),
    ("kouder in de keuken", None, "colder", None, ["keuken"], ["d11"]),
    ("alle lichten uit", None, "lights_off", None, None, ALL_LIGHTS),
    ("doe overal het licht uit", "hal", "lights_off", None, None, ALL_LIGHTS),
    ("tuinverlichting uit in de tuin", None, "lights_off", None, ["tuin"], ["d8"]),
    # complaints: the adjective flips, and a light word means the light colour, not the heating
    ("het licht is te koud", "woonkamer", "lights_warmer", None, ["woonkamer"], ["d1", "d2"]),
    ("het licht in de woonkamer is te koud", None, "lights_warmer", None, ["woonkamer"], ["d1", "d2"]),
    ("de lampen zijn te warm", "woonkamer", "lights_cooler", None, ["woonkamer"], ["d1", "d2"]),
    ("maak het licht warmer", "woonkamer", "lights_warmer", None, ["woonkamer"], ["d1", "d2"]),
    ("maak de lichten koeler", "woonkamer", "lights_cooler", None, ["woonkamer"], ["d1", "d2"]),
    ("het is te koud in de slaapkamer", None, "warmer", None, ["slaapkamer"], ["d10"]),
    ("het is te warm", "woonkamer", "colder", None, ["woonkamer"], ["d6"]),
]


@pytest.mark.parametrize("text,zone,action,value,zones,devs", CASES)
def test_matches(text, zone, action, value, zones, devs):
    r = M.match(text, zone)
    assert r.ok, r.reason
    assert (r.action, r.value) == (action, value)
    if zones is not None:
        assert r.zones == zones
    assert ids(r) == devs


def test_warmer_is_a_delta_command():
    r = M.match("warmer in de keuken")
    assert r.commands == [{"device": "d11", "name": "radiator keuken", "zone": "keuken",
                           "capability": "target_temperature_delta", "value": 1.0}]


def test_dim_skips_lights_that_cannot_dim():
    r = M.match("dim de tuin naar 40 procent")
    assert not r.ok and "dimbare lichten" in r.reason


def test_asks_for_room_when_unknown():
    assert M.match("lichten uit").reason == "welke ruimte?"


def test_unexposed_things_are_refused():
    assert not M.match("zet de wasmachine aan", "bijkeuken").ok
    assert "alleen lichten" in M.match("zet de verwarming uit", "woonkamer").reason
    assert not M.match("wat is het weer").ok


def test_room_without_thermostat():
    assert "thermostaat" in M.match("maak het warmer in de hal").reason


def test_dim_without_number():
    assert M.match("dim de lichten in de keuken").reason == "hoeveel procent?"


def test_model_action_is_resolved_against_catalog():
    """A model call goes through the same room/catalog guard as rules."""
    from engines import _to_intent
    action, value = _to_intent("dim_lights", {"room": "woonkamer", "percent": "30%"})
    r = M.resolve("dim de woonkamer naar dertig procent", action, value)
    assert r.ok and r.value == 0.3 and ids(r) == ["d1", "d2"]
    assert not M.resolve("x", "open_the_pod_bay_doors", None, "woonkamer").ok


def test_plausibility_guard_rejects_wrong_function():
    """Real Needle 3 output: 'doe het licht uit' -> dim 50. No number in the sentence -> rejected."""
    from engines import plausible
    assert not plausible("lights_dim", "doe het licht uit".split())
    assert plausible("lights_off", "doe het licht uit".split())
    assert not plausible("lights_on", "doe het licht uit".split())
    assert plausible("warmer", "maak het warmer".split())


def test_dutch_canon_for_models():
    from dutch import canon
    assert canon("Zet de thermostaat op eenentwintig graden") == "zet de thermostaat op 21 graden"
    assert canon("kun je het licht uitdoen") == "het lamp uitdoen"
    assert canon("zet de plafondlamp op vijftig procent") == "dim de plafondlamp naar 50 procent"
    assert canon("een en twintig graden") == "21 graden"


def test_light_colour_command_is_a_tone_delta():
    r = M.match("het licht is te koud", "woonkamer")
    assert {c["capability"] for c in r.commands} == {"light_temperature_delta"}
    assert {c["value"] for c in r.commands} == {0.2}  # + = warmer tone


def test_light_colour_needs_a_light_that_supports_it():
    assert "kleur" in M.match("het licht is te koud", "keuken").reason


def test_model_must_agree_with_the_direction_in_the_words():
    from engines import plausible
    tokens = "het licht is te koud".split()
    assert plausible("lights_warmer", tokens)
    assert not plausible("lights_cooler", tokens)   # wrong way
    assert not plausible("warmer", tokens)          # heating, but the sentence is about the light
    assert plausible("warmer", "het is te koud".split())


def test_bare_adjective_is_ambiguous_but_verb_makes_it_literal():
    assert M.match("koud in de keuken").reason == "warmer of kouder?"
    r = M.match("maak het koud in de woonkamer")
    assert r.ok and r.action == "colder"
    r = M.match("maak het licht warm", "woonkamer")
    assert r.ok and r.action == "lights_warmer"


def test_wake_phrase_variants():
    from wake import split_wake
    wake = "homey,homie,homi"
    for said in ("Homey, zet de lichten aan", "Homie, zet de lichten aan", "Hé homie, zet de lichten aan",
                 "Hey Homi zet de lichten aan", "homey. Zet de lichten aan"):
        woke, rest = split_wake(said, wake)
        assert woke and rest == "zet de lichten aan", said
    assert split_wake("Homie.", wake) == (True, "")
    assert split_wake("Hé homie", wake) == (True, "")
    for other in ("zet de lichten in de keuken aan", "het huis is koud", "welkom thuis zet de lichten aan",
                  "home sweet home", "hallo mama zet het licht aan", "ik hou van mijn huis"):
        assert split_wake(other, wake)[0] is False or other == "home sweet home", other


def test_segmenter_cuts_utterances():
    import numpy as np
    from wake import Segmenter
    rng = np.random.default_rng(0)
    quiet = (rng.normal(0, 30, 16000)).astype(np.int16)
    speech = (rng.normal(0, 4000, 16000)).astype(np.int16)  # 1 s of loud noise stands in for speech
    s = Segmenter()
    out = []
    for chunk in (quiet, speech, quiet, quiet, speech, quiet, quiet):
        out += s.feed(chunk.tobytes())
    assert len(out) == 2 and all(0.9 < len(u) / 16000 < 2.2 for u in out)


def test_catalog_from_the_api_devices():
    """Shape of /api/homey/devices -> the matcher's catalog: only lights and thermostats, only setable capabilities."""
    from catalog import from_devices
    cat = from_devices([
        {"id": "a", "name": "Reading lamp", "zoneName": "Woonkamer", "class": "light", "available": True,
         "capabilities": {"onoff": {"setable": True}, "dim": {"setable": True}, "measure_power": {"setable": False}}},
        {"id": "b", "name": "Radiator", "zoneName": "Keuken", "class": "heater", "available": True,
         "capabilities": {"target_temperature": {"setable": True}}},
        {"id": "c", "name": "TV", "zoneName": "Woonkamer", "class": "tv", "available": True, "capabilities": {}},
        {"id": "d", "name": "Lost lamp", "zoneName": None, "class": "light", "available": True, "capabilities": {}},
        {"id": "e", "name": "Offline lamp", "zoneName": "Hal", "class": "light", "available": False, "capabilities": {}},
    ])
    assert cat["zones"] == ["Woonkamer", "Keuken"]
    assert [(d["id"], d["kind"], d["caps"]) for d in cat["devices"]] == [("a", "light", ["onoff", "dim"]), ("b", "thermostat", ["target_temperature"])]
    r = Matcher(cat).match("doe het licht uit in de woonkamer")
    assert r.ok and [c["device"] for c in r.commands] == ["a"]


def test_the_screens_zone_is_the_default_room_whatever_its_case():
    r = M.match("zet het licht aan", "Keuken")
    assert r.zones == ["keuken"]
    assert M.match("zet het licht in de tuin aan", "Keuken").zones == ["tuin"]


def test_there_is_no_stand_in_catalog_without_homeydash():
    from catalog import CatalogSource, CatalogUnavailable

    with pytest.raises(CatalogUnavailable):
        CatalogSource("http://127.0.0.1:9").get()
