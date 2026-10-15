"""Post-STT junk filter for live PCM (aligned with Vexa CCaaS hallucination-filter)."""

from __future__ import annotations

import re

# Whisper often emits language names on silence / wrong auto-detect (e.g. "Telugu").
_LANGUAGE_NAME_JUNK = frozenset(
    {
        "english",
        "telugu",
        "hindi",
        "tamil",
        "kannada",
        "malayalam",
        "marathi",
        "bengali",
        "gujarati",
        "punjabi",
        "urdu",
        "spanish",
        "french",
        "german",
        "chinese",
        "japanese",
        "korean",
        "arabic",
        "portuguese",
        "russian",
        "italian",
        "dutch",
        "polish",
        "vietnamese",
        "thai",
        "indonesian",
        "mandarin",
        "cantonese",
    }
)

# Common faster-whisper silence hallucinations (subset of Vexa phrase lists).
_PHRASE_JUNK = frozenset(
    {
        "thank you for watching",
        "thanks for watching",
        "please subscribe",
        "subscribe to my channel",
        "like and subscribe",
        "see you next time",
        "bye bye",
        "music",
        "applause",
        "silence",
        "subtitle",
        "subtitles",
        "caption",
        "captions",
        "foreign",
        "foreign language",
        "speaking foreign language",
        "speaking in foreign language",
        "be back",
        "i'll be back",
        "i will be back",
        "back in a minute",
        "one moment",
        "hold on",
        "youtube",
        "www",
        "http",
        "https",
    }
)


def _normalize_phrase(text: str) -> str:
    t = text.strip().lower()
    t = re.sub(r"[.!?…]+$", "", t)
    t = re.sub(r"\.{2,}$", "", t)
    return t.strip()


def is_whisper_hallucination(text: str) -> bool:
    """True when STT output should be dropped before Heard / persist."""
    if not text or not text.strip():
        return True

    trimmed = text.strip()
    lower = trimmed.lower()
    norm = _normalize_phrase(trimmed)

    if norm in _PHRASE_JUNK or lower in _PHRASE_JUNK:
        return True
    if norm in _LANGUAGE_NAME_JUNK or lower in _LANGUAGE_NAME_JUNK:
        return True

    # "Telugu." / "English!" after normalize
    if norm in _LANGUAGE_NAME_JUNK:
        return True

    words = trimmed.split()
    if len(words) == 1:
        w = _normalize_phrase(words[0])
        if w in _LANGUAGE_NAME_JUNK:
            return True
        # Single-token junk under 10 chars unless it looks like real speech (has vowels + length)
        if len(w) < 4 and w not in {"yes", "no", "ok", "okay", "hi", "hey", "crm", "b2b"}:
            return True

    # Repetition loop: same 3–6 word phrase repeated 3+ times (Vexa heuristic).
    if len(words) >= 9:
        for plen in range(3, 7):
            phrase = " ".join(words[:plen]).lower()
            count = 0
            for i in range(0, len(words) - plen + 1, plen):
                if " ".join(words[i : i + plen]).lower() == phrase:
                    count += 1
            if count >= 3:
                return True

    return False
