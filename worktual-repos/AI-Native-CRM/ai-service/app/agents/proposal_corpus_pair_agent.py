"""LLM: score how related a requirement extract is to a proposal extract."""

from __future__ import annotations

import logging
import re
from typing import Any

from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.llm import (
    generate_proposal_ai_text as generate_ai_text,
    is_ai_configured,
    proposal_llm_configured,
)

logger = logging.getLogger(__name__)

PAIR_TEXT_CHARS = 8_000

SYSTEM = sectioned_system_prompt(
    role="You score how related a sales requirement document is to a winning proposal.",
    goal=(
        "Return confidence 0–1 for the user-declared requirement/proposal slot(s). "
        "This is advisory relatedness, not a decision to accept or reject the pair."
    ),
    instructions=(
        "- Use ONLY the provided item ids.\n"
        "- When one requirement and one proposal are provided, always return that pair. "
        "Do not search for other matches and do not omit the pair.\n"
        "- confidence is a real 0–1 score, never copied from the schema example.\n"
        "- 0.75–0.95: same customer / product / channels / scoped solutions; "
        "the proposal is written for this requirement.\n"
        "- 0.40–0.74: overlapping domain but weak coverage.\n"
        "- 0.00–0.29: different customers or products, or one side unreadable.\n"
        "- Extra spaces between words are a PDF export artifact — ignore them.\n"
        "- gaps: short list of requirement themes not clearly answered in the proposal."
    ),
    context="Requirement and proposal extracts are in the user message.",
    output=(
        'Return ONLY JSON: {"pairs":[{"requirementItemId":"req","proposalItemId":"prop",'
        '"confidence":0.86,"gaps":["pricing detail"]}]}'
    ),
    guardrails="Never invent item ids. Never invent customer names. Never return 0.0 as a placeholder.",
)


def normalize_pair_text(text: str) -> str:
    """Collapse PDF/Word letter-spacing so Google Docs exports stay readable."""
    cleaned = (text or "").replace("\u00a0", " ")
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def clamp_confidence(value: Any, *, default: float = 0.6) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number > 1.0:
        number = number / 100.0 if number <= 100 else 1.0
    return max(0.0, min(1.0, number))


def _item_id(item: dict[str, Any]) -> str:
    return str(item.get("itemId") or "")


def _item_text(item: dict[str, Any]) -> str:
    return str(item.get("fullText") or item.get("text") or "")


def _item_for_prompt(item: dict[str, Any]) -> dict[str, str]:
    return {
        "itemId": _item_id(item),
        "filename": str(item.get("filename") or ""),
        "kind": str(item.get("kind") or ""),
        "fullText": normalize_pair_text(_item_text(item))[:PAIR_TEXT_CHARS],
    }


def _resolve_id(raw: Any, items: list[dict[str, Any]]) -> str:
    value = str(raw or "").strip()
    ids = [_item_id(item) for item in items if _item_id(item)]
    if value in ids:
        return value
    lowered = value.lower()
    for item in items:
        item_id = _item_id(item)
        filename = str(item.get("filename") or "")
        if lowered == item_id.lower() or (
            filename
            and lowered
            in {filename.lower(), filename.lower().rsplit(".", 1)[0]}
        ):
            return item_id
    if len(ids) == 1:
        return ids[0]
    return ""


def _fail(reason: str) -> dict[str, Any]:
    return {
        "ok": False,
        "status": "failed",
        "pairs": [],
        "source": "ai",
        "reason": reason,
        "error": reason,
    }


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    requirements = (
        body.get("requirements") if isinstance(body.get("requirements"), list) else []
    )
    proposals = body.get("proposals") if isinstance(body.get("proposals"), list) else []
    requirements = [row for row in requirements if isinstance(row, dict)]
    proposals = [row for row in proposals if isinstance(row, dict)]

    if not requirements or not proposals:
        return _fail("missing_side")

    if not (proposal_llm_configured() or is_ai_configured()):
        return _fail("llm_not_configured")

    prompt_reqs = [_item_for_prompt(row) for row in requirements]
    prompt_props = [_item_for_prompt(row) for row in proposals]
    user = (
        "Score the user-declared requirement/proposal pair(s). "
        "If only one of each is present, return exactly that pair.\n\n"
        "Requirements:\n"
        + json_dumps(prompt_reqs)
        + "\n\nProposals:\n"
        + json_dumps(prompt_props)
    )
    try:
        text = await generate_ai_text(
            system=SYSTEM,
            user=user,
            max_tokens=2500,
            timeout_ms=90_000,
        )
        payload = extract_json(text or "") or {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-corpus-pair LLM failed")
        return _fail(f"llm_error:{exc}")

    if not text:
        return _fail("llm_empty")

    raw_pairs = payload.get("pairs") if isinstance(payload.get("pairs"), list) else []
    pairs: list[dict[str, Any]] = []
    for raw in raw_pairs:
        if not isinstance(raw, dict):
            continue
        rid = _resolve_id(
            raw.get("requirementItemId") or raw.get("requirement_item_id"),
            requirements,
        )
        pid = _resolve_id(
            raw.get("proposalItemId") or raw.get("proposal_item_id"),
            proposals,
        )
        if not rid or not pid:
            continue
        pairs.append(
            {
                "requirementItemId": rid,
                "proposalItemId": pid,
                "confidence": clamp_confidence(raw.get("confidence")),
                "gaps": [
                    str(gap)[:200]
                    for gap in (
                        raw.get("gaps") if isinstance(raw.get("gaps"), list) else []
                    )[:8]
                ],
            }
        )

    if not pairs and len(requirements) == 1 and len(proposals) == 1:
        first = raw_pairs[0] if raw_pairs and isinstance(raw_pairs[0], dict) else {}
        if "confidence" in first:
            pairs = [
                {
                    "requirementItemId": _item_id(requirements[0]),
                    "proposalItemId": _item_id(proposals[0]),
                    "confidence": clamp_confidence(first.get("confidence")),
                    "gaps": [
                        str(gap)[:200]
                        for gap in (
                            first.get("gaps")
                            if isinstance(first.get("gaps"), list)
                            else []
                        )[:8]
                    ],
                }
            ]

    if not pairs:
        return _fail("empty_llm_pairs")

    return {
        "ok": True,
        "status": "ok",
        "pairs": pairs,
        "source": "ai",
    }


def json_dumps(value: Any) -> str:
    import json

    return json.dumps(value, ensure_ascii=False)[:40_000]
