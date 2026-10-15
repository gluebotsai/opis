"""LLM soft intent for sales when static heuristics miss typos / odd phrasing."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.agents.coworker_shared import parse_assistant_json
from app.llm import generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

_SYSTEM = """You classify a CRM sales chat message into a structured intent.
Return ONLY valid JSON (no markdown):
{
  "intent": "create_proposal" | "create_deal" | "create_quote" | "schedule" | "open_deal" | "other",
  "dealId": "<id from the deals list or null>",
  "customerHint": "<person/company name if any>",
  "topic": "<product/scope if any>",
  "confidence": 0.0
}

Rules:
- Prefer matching dealId from the provided deals when the user names a person/company (tolerate typos).
- create_proposal = they want a proposal *document*, not pipeline stage "propose".
- schedule = meeting/call/appointment.
- If unsure, intent=other and confidence < 0.5.
- Never invent deal IDs not in the list.
"""


def _deals_brief(catalog: dict[str, Any] | None, *, limit: int = 40) -> list[dict[str, str]]:
    deals = (catalog or {}).get("deals") if isinstance((catalog or {}).get("deals"), list) else []
    out: list[dict[str, str]] = []
    for raw in deals[:limit]:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        out.append(
            {
                "id": str(raw["id"]),
                "title": str(raw.get("title") or "")[:120],
                "companyName": str(raw.get("companyName") or "")[:80],
                "contactName": str(raw.get("contactName") or "")[:80],
            }
        )
    return out


async def classify_sales_intent(
    text: str,
    catalog: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Return structured intent or None if AI unavailable / unusable."""
    if not is_ai_configured():
        return None
    brief = _deals_brief(catalog)
    user = (
        f"User message:\n{(text or '').strip()[:800]}\n\n"
        f"Deals (JSON):\n{json.dumps(brief, ensure_ascii=False)[:6000]}"
    )
    try:
        raw = await generate_ai_text(
            system=_SYSTEM,
            user=user,
            max_tokens=400,
            timeout_ms=15_000,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("sales intent LLM failed: %s", exc)
        return None
    if not raw:
        return None
    # Allow bare JSON or fenced
    payload = parse_assistant_json(raw)
    if not payload:
        try:
            start, end = raw.find("{"), raw.rfind("}")
            if start >= 0 and end > start:
                payload = json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            payload = None
    if not isinstance(payload, dict):
        return None
    intent = str(payload.get("intent") or "other").strip().lower()
    if intent not in (
        "create_proposal",
        "create_deal",
        "create_quote",
        "schedule",
        "open_deal",
        "other",
    ):
        intent = "other"
    deal_id = payload.get("dealId")
    deal_id_s = str(deal_id).strip() if deal_id not in (None, "", "null") else ""
    allowed = {d["id"] for d in brief}
    if deal_id_s and deal_id_s not in allowed:
        deal_id_s = ""
    try:
        confidence = float(payload.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    return {
        "intent": intent,
        "dealId": deal_id_s or None,
        "customerHint": str(payload.get("customerHint") or "").strip()[:80] or None,
        "topic": str(payload.get("topic") or "").strip()[:160] or None,
        "confidence": max(0.0, min(1.0, confidence)),
    }


def looks_like_soft_sales_create(text: str) -> bool:
    """Cheap gate — only spend an LLM call when the utterance smells like create/schedule."""
    lower = (text or "").lower()
    return bool(
        re.search(
            r"\b(creat|draft|writ|prepar|generat|mak|start|build|schedul|book|arrang|"
            r"quot|propos|meeting|call|deal|opportunit|rfp)\w*\b",
            lower,
        )
    )
