"""Grounded LLM structure for a stored article. Regex fallback stays in formatter."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from formatter import extract_steps, extract_symptoms, flatten_text, format_article

logger = logging.getLogger("kb-embed")

STRUCTURE_PROMPT = """You extract troubleshooting fields from a knowledge-base article.

Return ONLY valid JSON with this shape:
{"symptoms": ["..."], "steps": ["..."]}

Rules:
- Use only facts that appear in the title or content. Never invent.
- symptoms: short problem phrases the user would search for. Empty array if none.
- steps: ordered actions to take. Empty array if there is no procedure.
- Do not add product, version, error_code, root_cause, verification, or escalation fields.
- Do not rewrite the article. Copy short phrases from the source when possible.
"""


def _model_url() -> str:
    return (
        os.getenv("MODEL_URL")
        or os.getenv("COWORKER_MODEL_URL")
        or ""
    ).strip()


def _model_name() -> str:
    return (
        os.getenv("MODEL_NAME")
        or os.getenv("COWORKER_MODEL_NAME")
        or "worktual-gemma"
    ).strip()


def _api_key() -> str:
    return (os.getenv("API_KEY") or os.getenv("COWORKER_MODEL_API_KEY") or "empty").strip()


def _timeout() -> float:
    raw = os.getenv("KB_STRUCTURE_TIMEOUT", "45")
    try:
        value = float(raw)
    except ValueError:
        return 45.0
    return value if value > 0 else 45.0


def normalize_for_match(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def is_grounded(phrase: str, source: str) -> bool:
    text = (phrase or "").strip()
    if len(text) < 2:
        return False
    hay = (source or "").lower()
    needle = text.lower().strip(" .,-;:")
    if len(needle) >= 4 and needle in hay:
        return True
    compact_phrase = normalize_for_match(text)
    compact_source = normalize_for_match(source)
    return len(compact_phrase) >= 8 and compact_phrase in compact_source


def ground_phrases(phrases: list[str], source: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in phrases:
        item = str(raw or "").strip().strip(".")
        if not item or not is_grounded(item, source):
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _parse_llm_payload(raw: str) -> dict[str, list[str]] | None:
    text = (raw or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    symptoms = data.get("symptoms")
    steps = data.get("steps")
    if not isinstance(symptoms, list) or not isinstance(steps, list):
        return None
    return {
        "symptoms": [str(s).strip() for s in symptoms if str(s).strip()],
        "steps": [str(s).strip() for s in steps if str(s).strip()],
    }


def call_structure_llm(title: str, content: str) -> dict[str, list[str]] | None:
    base = _model_url()
    if not base:
        logger.info("[structure] MODEL_URL unset — skip LLM")
        return None
    try:
        from openai import OpenAI
    except ImportError:
        logger.warning("[structure] openai package missing — skip LLM")
        return None
    client = OpenAI(api_key=_api_key(), base_url=base.rstrip("/"), timeout=_timeout())
    user = f"Title:\n{title}\n\nContent:\n{content}"
    try:
        result = client.chat.completions.create(
            model=_model_name(),
            messages=[
                {"role": "system", "content": STRUCTURE_PROMPT},
                {"role": "user", "content": user},
            ],
            temperature=0.15,
            max_tokens=800,
        )
    except Exception as exc:
        logger.warning("[structure] LLM call failed: %s", exc)
        return None
    message = result.choices[0].message
    return _parse_llm_payload(getattr(message, "content", "") or "")


def structure_article(title: str, content: str) -> tuple[list[str], list[str], str]:
    """Return (symptoms, steps, path) where path is llm, regex, or body."""
    source = f"{title}\n{content}"
    parsed = call_structure_llm(title, content)
    if parsed is not None:
        symptoms = ground_phrases(parsed["symptoms"], source)
        steps = ground_phrases(parsed["steps"], source)
        if len(steps) < 2:
            steps = []
        if symptoms or steps:
            logger.info("[structure] path=llm symptoms=%d steps=%d", len(symptoms), len(steps))
            return symptoms, steps, "llm"

    symptoms = extract_symptoms(content)
    steps = extract_steps(content)
    if symptoms or steps:
        logger.info("[structure] path=regex symptoms=%d steps=%d", len(symptoms), len(steps))
        return symptoms, steps, "regex"

    logger.info("[structure] path=body")
    return [], [], "body"


def format_structured_article(
    *,
    organization_id: str,
    article_id: str,
    title: str,
    content: str,
) -> dict[str, Any]:
    title_s = str(title or "").strip()
    body = str(content or "").strip()
    symptoms, steps, path = structure_article(title_s, body)
    doc = format_article(
        organization_id=organization_id,
        article_id=article_id,
        title=title_s,
        content=body,
        symptoms=symptoms,
        steps=steps,
    )
    doc["structure_path"] = path
    if not steps:
        doc["text"] = flatten_text(title_s, body, symptoms, [])
    return doc
