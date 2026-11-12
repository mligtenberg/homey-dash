import pytest

from timer import parse


@pytest.mark.parametrize("text, seconds, name", [
    ("zet een timer voor 5 minuten", 300, None),
    ("zet een timer voor vijf minuten", 300, None),
    ("timer van tien minuten", 600, None),
    ("zet een timer op 10 min", 600, None),
    ("zet een timer van 10min", 600, None),
    ("zet een timer voor een uur", 3600, None),
    ("zet een timer voor een uurtje", 3600, None),
    ("zet een timer voor twee uur", 7200, None),
    ("timer voor anderhalf uur", 5400, None),
    ("zet een timer voor een half uur", 1800, None),
    ("zet een timer voor een halfuur", 1800, None),
    ("zet een timer voor een kwartier", 900, None),
    ("zet een timer voor drie kwartier", 2700, None),
    ("zet een timer voor driekwartier", 2700, None),
    ("zet een timer voor 30 seconden", 30, None),
    ("zet een timer voor een minuut", 60, None),
    ("zet een timer voor twintig minuutjes", 1200, None),
    ("zet een timer voor 1 uur en 30 minuten", 5400, None),
    ("zet een timer voor een uur en twintig minuten", 4800, None),
    ("zet een timer voor een uur dertig", 5400, None),
    ("zet een timer voor 2 minuten en 30 seconden", 150, None),
    ("zet een timer voor eenentwintig minuten", 1260, None),
    ("zet een kookwekker van tien minuten", 600, None),
    ("tien minuten timer", 600, None),
    ("zet een timer voor 5 minuten met de naam pasta", 300, "Pasta"),
    ("zet een timer voor vijf minuten genaamd eieren koken", 300, "Eieren koken"),
    ("zet een timer van tien minuten voor de pizza", 600, "Pizza"),
    ("zet een timer voor de pasta van tien minuten", 600, "Pasta"),
    ("zet een timer voor de pasta op 10 minuten", 600, "Pasta"),
    ("zet een timer voor 10 minuten en noem hem thee", 600, "Thee"),
    ("zet een timer van een kwartier met de naam wasmachine ophangen", 900, "Wasmachine ophangen"),
])
def test_timer(text, seconds, name):
    assert parse(text) == (seconds, name, None)


def test_not_about_a_timer():
    assert parse("doe de lichten uit") is None
    assert parse("zet de lichten in de woonkamer op 50 procent") is None


def test_a_timer_without_a_length_asks_for_one():
    assert parse("zet een timer")[2] == "hoe lang moet de timer duren?"
    assert parse("zet een timer voor de pasta")[2] == "hoe lang moet de timer duren?"


def test_there_is_a_limit():
    assert parse("zet een timer voor 30 uur")[2] == "een timer duurt hooguit 24 uur"


@pytest.mark.parametrize("text", [
    "zet een time r van 1 minuut", "zet een tijd mer van 1 minuut", "zet een timmer van een minuut",
    "zet een time van 1 minuut", "zet een tijdje van 1 minuut", "stel een wekker in voor 5 minuten",
])
def test_a_mishearing_of_timer_is_still_a_timer(text):
    assert parse(text)[2] is None and parse(text)[0] > 0


@pytest.mark.parametrize("text", [
    "zet het licht in de woonkamer aan", "zet de verwarming op 20 graden", "dim de lichten naar 50 procent",
    "doe de lichten over een uur uit",
])
def test_other_commands_are_no_timers(text):
    assert parse(text) is None


@pytest.mark.parametrize("text, held", [
    ("zet een timer voor", True), ("zet een timer", True), ("dim de lichten naar", True),
    ("zet een timer voor 5 seconden", False), ("doe de lichten uit", False),
])
def test_a_sentence_cut_off_by_a_pause_is_held_for_the_rest(text, held):
    from app import unfinished

    assert unfinished(text) is held
