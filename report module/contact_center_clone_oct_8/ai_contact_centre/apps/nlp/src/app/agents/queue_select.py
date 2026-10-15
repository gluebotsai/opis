"""Pick a live-agent queue from NLP signals and org queue profiles."""

from __future__ import annotations

import json
from typing import Any, Protocol

GENERIC_TOKENS = {
    "support bot",
    "general inquiry",
    "explicit live agent",
    "explicit request",
    "live agent",
    "human",
}

QUEUE_PICK_PROMPT = """You are an AI routing assistant for a CCaaS platform.
Your job is to classify the customer's request and select the most appropriate queue.

AVAILABLE QUEUES
{queue_list}

CUSTOMER INTERACTION
{conversation}

INSTRUCTIONS
1. Understand the customer's intent from the conversation.
2. Match the intent to the most relevant queue from AVAILABLE QUEUES.
3. You MUST choose exactly ONE queue.
4. The queue name MUST be exactly from AVAILABLE QUEUES.
5. Do NOT generate new queue names.
6. If multiple queues seem relevant, choose the BEST matching queue.

Return one JSON object only:
{{"queue_name": "<exact queue name>"}}
"""


class JsonLLM(Protocol):
    async def json(self, messages: list[dict[str, Any]]) -> dict[str, Any]: ...


def _as_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _normalize(value: str) -> str:
    return value.strip().lower().replace("_", " ").replace("-", " ")


def parse_queue_profiles(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    profiles: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or item.get("id") or "").strip()
        name = str(item.get("name") or "").strip()
        if not key and not name:
            continue
        profiles.append(
            {
                "key": key or name,
                "name": name or key,
                "description": str(item.get("description") or "").strip(),
                "skills": _as_string_list(item.get("skills")),
                "intents": _as_string_list(item.get("intents")),
            }
        )
    return profiles


def _profiles(raw: Any) -> list[dict[str, Any]]:
    return parse_queue_profiles(raw)


def match_queue_key(profiles: list[dict[str, Any]], selected: str | None) -> str | None:
    if not selected or not profiles:
        return None
    needle = _normalize(selected)
    for profile in profiles:
        if str(profile["key"]) == selected or _normalize(str(profile["name"])) == needle:
            return str(profile["key"])
    return None


def skills_for_queue_key(profiles: list[dict[str, Any]], key: str | None) -> list[str]:
    if not key:
        return []
    for profile in profiles:
        if str(profile["key"]) == key:
            return list(profile["skills"])
    return []


def _score(profile: dict[str, Any], tokens: list[str]) -> int:
    haystack = [
        _normalize(profile["name"]),
        *(_normalize(skill) for skill in profile["skills"]),
        *(_normalize(intent) for intent in profile["intents"]),
    ]
    score = 0
    for token in tokens:
        if len(token) < 3:
            continue
        if any(item == token for item in haystack if item):
            score += 2
        elif any(token in item or item in token for item in haystack if item):
            score += 1
    return score


def select_queue_key(
    tenant_context: dict[str, Any] | None,
    *,
    candidate_skills: list[str] | None = None,
    intent: str | None = None,
) -> str | None:
    """Offline fallback using structured signals only, else first profile."""
    profiles = _profiles((tenant_context or {}).get("queue_profiles"))
    if not profiles:
        return None

    tokens = [
        _normalize(token)
        for token in [*(candidate_skills or []), intent or ""]
        if _normalize(token) and _normalize(token) not in GENERIC_TOKENS
    ]
    if tokens:
        best: dict[str, Any] | None = None
        best_score = 0
        for profile in profiles:
            score = _score(profile, tokens)
            if score > best_score:
                best = profile
                best_score = score
        if best and best_score > 0:
            return str(best["key"])

    return str(profiles[0]["key"])


def _format_queue_list(profiles: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for profile in profiles:
        parts = [f"name={profile['name']}", f"key={profile['key']}"]
        if profile["description"]:
            parts.append(f"description={profile['description']}")
        if profile["skills"]:
            parts.append("skills=" + ", ".join(profile["skills"]))
        if profile["intents"]:
            parts.append("intents=" + ", ".join(profile["intents"]))
        lines.append("- " + "; ".join(parts))
    return "\n".join(lines)


async def select_queue_with_llm(
    llm: JsonLLM | None,
    queue_profiles: Any,
    conversation: str,
) -> tuple[str | None, list[str]]:
    """LLM picks exactly one queue from the live list; else first profile."""
    profiles = parse_queue_profiles(queue_profiles)
    if not profiles:
        return None, []

    fallback = str(profiles[0]["key"])
    fallback_skills = list(profiles[0]["skills"])
    if llm is None:
        return fallback, fallback_skills

    prompt = QUEUE_PICK_PROMPT.format(
        queue_list=_format_queue_list(profiles),
        conversation=conversation.strip() or "(empty)",
    )
    try:
        payload = await llm.json(
            [
                {"role": "system", "content": prompt},
                {"role": "user", "content": "Select the queue now."},
            ]
        )
        selected = payload.get("queue_name") or payload.get("queue_key") or payload.get("name")
        if isinstance(selected, str):
            matched = match_queue_key(profiles, selected)
            if matched:
                return matched, skills_for_queue_key(profiles, matched)
        if isinstance(payload, dict):
            raw = json.dumps(payload)
            matched = match_queue_key(profiles, raw)
            if matched:
                return matched, skills_for_queue_key(profiles, matched)
    except Exception:
        pass
    return fallback, fallback_skills
