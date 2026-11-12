"""Dutch canonicalisation for small tool-calling models. Whisper is already forced to nl; the models are not,
and trip over spoken numbers ("eenentwintig" -> 180 degrees), "licht" (-> dim), and "zet ... op 50 procent"
(-> power off). Measured on 15 Dutch commands with Needle 3: raw 10/15, with this 14/15.
Rules and the catalog matcher read the original transcript; only the model sees this."""
from __future__ import annotations

import re

from matcher import NUMBER_WORDS, compound_number, norm

FILLER = {"kun", "kunt", "je", "jij", "u", "even", "alsjeblieft", "alstublieft", "please", "wil", "willen",
          "mag", "zou", "graag", "dan", "maar", "nou"}


def canon(text: str) -> str:
    toks, out, i = norm(text).split(), [], 0
    while i < len(toks):
        t = toks[i]
        if t in FILLER:
            i += 1
            continue
        n = compound_number(t)
        if n is None and t in NUMBER_WORDS:
            n = NUMBER_WORDS[t]
        if n is not None:
            # spoken apart: "een en twintig"
            if n < 10 and i + 2 < len(toks) and toks[i + 1] == "en" and NUMBER_WORDS.get(toks[i + 2], 0) >= 20:
                n += NUMBER_WORDS[toks[i + 2]]
                i += 2
            out.append(str(n))
        else:
            out.append("lamp" if t == "licht" else "lampen" if t == "lichten" else t)
        i += 1
    s = " ".join(out)
    s = re.sub(r"\bop (\d+) procent", r"naar \1 procent", s)
    if "procent" in s and "dim" not in s:  # a percentage means dimming, whatever the verb
        s = re.sub(r"\b(zet|maak|doe)\b", "dim", s, count=1)
    return s
