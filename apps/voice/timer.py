"""Timer commands: "zet een timer voor vijf minuten", "timer van een uur en twintig minuten met de naam pasta",
"zet een kookwekker van anderhalf uur", "tien minuten timer voor de eieren".

parse(text) -> None when the sentence is not about a timer, else (seconds, name | None, reason | None).
The time units are read in all their spoken shapes: uur/uren/uurtje, minuut/minuten/min/minuutjes,
seconde/seconden/sec, kwartier, half uur, anderhalf uur, driekwartier, and a bare number after hours ("een uur
dertig"). The name comes after "met de naam", "genaamd", "noem hem" or "voor de".
"""
from __future__ import annotations

import re

from rapidfuzz import fuzz

from matcher import LIGHT_WORDS, NUMBER_WORDS, compound_number, norm

TIMER_WORDS = {"timer", "timers", "tijmer", "taimer", "kookwekker", "eierwekker", "afteller", "aftelklok"}

HOUR, MINUTE, SECOND = 3600, 60, 1
UNITS = {
    "uur": HOUR, "uren": HOUR, "uurtje": HOUR, "uurtjes": HOUR, "u": HOUR, "hour": HOUR, "hours": HOUR,
    "minuut": MINUTE, "minuten": MINUTE, "minuutje": MINUTE, "minuutjes": MINUTE, "min": MINUTE, "mins": MINUTE,
    "minute": MINUTE, "minutes": MINUTE,
    "seconde": SECOND, "seconden": SECOND, "secondes": SECOND, "secondje": SECOND, "secondjes": SECOND,
    "sec": SECOND, "secs": SECOND, "second": SECOND, "seconds": SECOND,
}
# Units that already carry their own amount.
FIXED = {
    "kwartier": 15 * MINUTE, "kwartiertje": 15 * MINUTE, "driekwartier": 45 * MINUTE,
    "halfuur": 30 * MINUTE, "halfuurtje": 30 * MINUTE, "anderhalfuur": 90 * MINUTE,
}
HALF = {"half", "halve"}
ANDERHALF = {"anderhalf", "anderhalve"}

NAME_AFTER = [("met", "de", "naam"), ("met", "naam"), ("onder", "de", "naam"), ("genaamd",), ("noem", "hem"), ("noem", "het"),
              ("noem", "de", "timer"), ("noem", "die"), ("noem", "m")]
ARTICLES = {"de", "het", "een", "mijn", "onze"}
STOP = {"van", "op", "voor", "en", "in", "om", "met", "die", "dat", "alsjeblieft", "alstublieft", "graag", "even", "aub"}


def words(text: str) -> list[tuple[str, str]]:
    """(original word, normalised word) pairs; the original is kept for the name."""
    out = []
    for w in re.findall(r"[^\W_]+(?:['’-][^\W_]+)*", text):
        n = norm(w).replace(" ", "")
        if n:
            out.append((w, n))
    return out


def number(tok: str) -> float | None:
    if tok.isdigit():
        return float(tok)
    if tok in NUMBER_WORDS:
        return float(NUMBER_WORDS[tok])
    if (n := compound_number(tok)) is not None:
        return float(n)
    return None


def duration(toks: list[str]) -> tuple[int, set[int]]:
    """(seconds, indexes of the words that spoke the duration)."""
    total, used, i = 0.0, set(), 0
    after_hours = False
    while i < len(toks):
        t = toks[i]
        # glued "5min", "10minuten"
        if (m := re.fullmatch(r"(\d+)([a-z]+)", t)) and m.group(2) in UNITS:
            total += int(m.group(1)) * UNITS[m.group(2)]
            used.add(i)
            after_hours = UNITS[m.group(2)] == HOUR
            i += 1
            continue
        if t in FIXED or (t in HALF and i + 1 < len(toks) and toks[i + 1] in {"uur", "uurtje"}):
            if t in HALF:
                total += 30 * MINUTE
                used |= {i, i + 1}
                i += 2
            else:
                n = number(toks[i - 1]) if i and number(toks[i - 1]) is not None and t == "kwartier" else None
                total += FIXED[t] * (n if n else 1)
                used.add(i)
                if n:
                    used.add(i - 1)
                i += 1
            after_hours = False
            continue
        if t in ANDERHALF and i + 1 < len(toks) and toks[i + 1] in {"uur", "uurtje"}:
            total += 90 * MINUTE
            used |= {i, i + 1}
            i += 2
            continue
        if t in UNITS:
            amount, used_prev = None, None
            if i and (n := number(toks[i - 1])) is not None:
                amount, used_prev = n, i - 1
                # "twee en dertig minuten" is rare; "een half uur" handled above; "x en een half minuut"
            elif t in {"uur", "uurtje", "minuut", "minuutje", "seconde", "secondje", "hour", "minute", "second"}:
                amount = 1.0  # "een uur" lost its number ("uur" alone as in "timer voor een uurtje")
            if amount is not None:
                total += amount * UNITS[t]
                used.add(i)
                if used_prev is not None:
                    used.add(used_prev)
                # "een minuut en een half": the half that follows
                if i + 3 < len(toks) and toks[i + 1] == "en" and toks[i + 2] == "een" and toks[i + 3] in HALF:
                    total += UNITS[t] / 2
                    used |= {i + 1, i + 2, i + 3}
                    i += 3
                after_hours = UNITS[t] == HOUR
            i += 1
            continue
        # a bare number straight after hours: "een uur dertig" -> 1 h 30 min
        if after_hours and (n := number(t)) is not None and i not in used and (i + 1 >= len(toks) or toks[i + 1] not in UNITS):
            total += n * MINUTE
            used.add(i)
            after_hours = False
            i += 1
            continue
        if t != "en":
            after_hours = False
        i += 1
    return int(round(total)), used


def name_of(pairs: list[tuple[str, str]], used: set[int]) -> str | None:
    toks = [n for _, n in pairs]
    start = None
    for i in range(len(toks)):
        for pat in NAME_AFTER:
            if tuple(toks[i:i + len(pat)]) == pat:
                start = i + len(pat)
                break
        if start is not None:
            break
    if start is None:
        # "voor de pasta" / "voor pasta" / "voor mijn eieren": a "voor" that does not lead into the duration
        for i, t in enumerate(toks):
            if t == "voor" and i + 1 < len(toks) and i + 1 not in used and not (number(toks[i + 1]) is not None):
                j = i + 1
                if toks[j] in ARTICLES and j + 1 < len(toks):
                    j += 1
                if j not in used and toks[j] not in UNITS and toks[j] not in FIXED and toks[j] not in TIMER_WORDS:
                    start = j
                    break
    if start is None:
        return None
    out = []
    for j in range(start, len(pairs)):
        if j in used or toks[j] in STOP and out:
            break
        if toks[j] in ARTICLES and not out:
            continue
        out.append(pairs[j][0])
    name = " ".join(out).strip()
    return (name[0].upper() + name[1:]) if name else None


# What a sentence with a time in it is about when it is about something else.
OTHER_THINGS = {"verwarming", "thermostaat", "graden", "graad", "procent", "dim", "dimmen", "warmer", "kouder", "temperatuur"}
SET_VERBS = {"zet", "stel", "start", "maak", "begin"}


def is_timer(toks: list[str], seconds: int) -> bool:
    """Says "timer" (as Whisper may write it: tijmer, time r), or sets something up for a length of time and is about nothing else."""
    if set(toks) & TIMER_WORDS:
        return True
    windows = toks + [a + b for a, b in zip(toks, toks[1:])]
    if any(len(w) >= 4 and max(fuzz.ratio(w, k) for k in ("timer", "tijmer", "kookwekker", "eierwekker")) >= 75 for w in windows):
        return True
    return (seconds > 0 and bool(set(toks[:2]) & SET_VERBS) and not set(toks) & OTHER_THINGS
            and not any(t.endswith(tuple(LIGHT_WORDS)) for t in toks))


def parse(text: str) -> tuple[int, str | None, str | None] | None:
    pairs = words(text)
    toks = [n for _, n in pairs]
    seconds, used = duration(toks)
    if not is_timer(toks, seconds):
        return None
    name = name_of(pairs, used)
    if seconds <= 0:
        return 0, name, "hoe lang moet de timer duren?"
    if seconds > 24 * HOUR:
        return seconds, name, "een timer duurt hooguit 24 uur"
    return seconds, name, None
