"""Match user questions to certified warehouse KPIs (routing gate only)."""

from __future__ import annotations

import re
from functools import lru_cache

from app.agents.reports_b2b.core.loader import load_kpis

# Common speech variants before KPI substring / regex matching.
_WIN_WON_NORMALIZE = re.compile(r"\bwin(?:ning)?\s+(deals?|opportunit(?:y|ies))\b", re.I)
_CLOSED_WON_NORMALIZE = re.compile(r"\bclosed\s+win\b", re.I)

_AGGREGATE_METRIC = re.compile(
    r"\b("
    r"averag\w*|avg|mean|total|sum|weighted"
    r")\s+(probab\w*|deal\s+size|aging|sales\s+cycle|pipeline|revenue|stage\s+weight"
    r")\b|"
    r"\bprobab\w*\b.{0,32}\b(deals?|opportunit(?:y|ies)|pipeline)\b|"
    r"\b(deals?|pipeline|opportunit(?:y|ies))\b.{0,32}\bprobab\w*\b|"
    r"\bwin\s+rate\b|"
    r"\bsales\s+velocity\b|"
    r"\bexpected\s+close\b",
    re.I,
)

# Rankings, leaderboards, and rep/owner comparisons (warehouse reads).
_COMPARATIVE_ANALYTICS = re.compile(
    r"\b("
    r"who\s+(?:has|have|'s|is|are)|"
    r"which\s+(?:rep|reps|owner|owners|person|people|sales\s*(?:person|people|rep|reps)|"
    r"salesperson|team|member|user|users)|"
    r"compare|comparison|versus|vs\.?"
    r")\b.{0,56}\b("
    r"more|most|fewer|less|best|top|highest|lowest|better|worse|leading|"
    r"closing|winning|performing|ahead"
    r")\b|"
    r"\b(more|most|fewer|less|best|top|highest|lowest|better|worse)\b.{0,56}\b("
    r"won|lost|closed|open|pipeline|revenue|deals?|opportunit(?:y|ies)|"
    r"win\s*rate|bookings|quota|leaderboard"
    r")\b|"
    r"\b(leaderboard|doing\s+better|performing\s+better|closes?\s+the\s+most|"
    r"win(?:s|ning)?\s+the\s+most|top\s+rep|best\s+rep|top\s+performer)\b|"
    r"\b(breakdown|split|distribution|trend|"
    r"by\s+(?:stage|owner|rep|product|territory|source|status|lead_status|lead\s+status))\b|"
    r"\bshow\s+me\b.{0,48}\b(leads?|contacts?|deals?|pipeline)\b.{0,40}\b"
    r"(?:by|breakdown|distribution|status|stage|owner)\b",
    re.I,
)

_WAREHOUSE_RANKING = re.compile(
    r"\b("
    r"highest|largest|biggest|top|most|more|greater|maximum|max\b|"
    r"which\s+(?:deal|owner|opportunity|open\s+deal|opportunities?|rep|reps)|"
    r"rank(?:ed|ing)?"
    r")\b.{0,48}\b("
    r"deals?|opportunit(?:y|ies)|amount|value|pipeline|owner|rep|revenue|won|lost"
    r")\b|"
    r"\b(deal\s+amount|deal\s+value|open\s+deal)\b.{0,40}\b("
    r"highest|largest|biggest|most|more|top|high"
    r")\b|"
    r"\bwhich\s+owner\b.{0,40}\b(deal|amount|pipeline|value|won|lost)\b",
    re.I,
)

# Obvious metric questions without certified KPI substring (still warehouse-bound).
_METRIC_QUESTION = re.compile(
    r"\b("
    r"how\s+(?:many|much)|number\s+of|count\s+of|what(?:'s|\s+is)\s+(?:our|the|my)\s+|"
    r"show\s+(?:me\s+)?(?:the\s+)?(?:pipeline|report|analytics|breakdown|trend|forecast)|"
    r"pipeline\s+by|win\s*rate|closed\s*won|closed\s*lost|sales\s+funnel|"
    r"quota\s+attainment|forecast\s+vs|overdue\s+amount|outstanding"
    r")\b",
    re.I,
)

# Mutation / navigation — do not treat as analytics even if "deals" appears.
_NON_ANALYTICS_VERB = re.compile(
    r"\b("
    r"create|add|new|update|change|edit|delete|remove|assign|reassign|open|navigate|"
    r"go\s+to|take\s+me|import|pull|fetch|compose|send|schedule|draft|propose"
    r")\b",
    re.I,
)


def normalize_analytics_question(question: str) -> str:
    """Normalize colloquial metric wording for routing gates only."""
    text = (question or "").strip().lower()
    if not text:
        return text
    text = _CLOSED_WON_NORMALIZE.sub("closed won", text)
    text = _WIN_WON_NORMALIZE.sub(r"won \1", text)
    return text


@lru_cache(maxsize=1)
def _certified_phrases() -> tuple[str, ...]:
    phrases: set[str] = set()
    for kpi_id, meta in load_kpis().items():
        if not isinstance(meta, dict):
            continue
        phrases.add(str(kpi_id).replace("_", " ").lower())
        label = str(meta.get("label") or "").strip().lower()
        if label:
            phrases.add(label)
        for raw in meta.get("synonyms") or []:
            syn = str(raw).strip().lower()
            if len(syn) >= 3:
                phrases.add(syn)
    return tuple(sorted(phrases, key=len, reverse=True))


def question_matches_certified_kpi(question: str) -> bool:
    """True when the utterance maps to a B2B KPI catalog entry or obvious aggregate metric."""
    text = normalize_analytics_question(question)
    if not text:
        return False
    if _AGGREGATE_METRIC.search(text):
        return True
    for phrase in _certified_phrases():
        if phrase and phrase in text:
            return True
    return False


_ANALYTICS_QUESTION_MARKERS = re.compile(
    r"(?:\?|\b(who|which|how\s+many|how\s+much|what(?:'s|\s+is| are)|"
    r"show\s+(?:me\s+)?(?:the\s+)?(?:pipeline|report|analytics|breakdown|trend|forecast)|"
    r"compare|leaderboard|performing\s+better|doing\s+better)\b)",
    re.I,
)


def question_matches_comparative_analytics(question: str) -> bool:
    """Rankings, owner/rep comparisons, breakdowns — warehouse analytics routing."""
    text = normalize_analytics_question(question)
    if not text:
        return False
    if _NON_ANALYTICS_VERB.search(text) and not _ANALYTICS_QUESTION_MARKERS.search(text):
        return False
    if _COMPARATIVE_ANALYTICS.search(text):
        return True
    if _WAREHOUSE_RANKING.search(text):
        return True
    if _METRIC_QUESTION.search(text):
        return True
    return False
