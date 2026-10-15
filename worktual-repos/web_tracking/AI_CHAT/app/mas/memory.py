"""Standalone question from chat history (LLM — no regex routing)."""

from __future__ import annotations

import json
import logging

from app.mas.prompts import read_layer
from app.services.llm_service import LLMServiceError, llm_service

logger = logging.getLogger(__name__)


async def to_standalone_query(
    message: str,
    history: list[dict[str, str]],
    *,
    dashboard_period: str | None,
    last_standalone: str | None,
) -> str:
    text = (message or "").strip()
    if not text:
        return text
    if not history or len(history) <= 1:
        return text

    system = read_layer("standalone.md")
    pill = dashboard_period or "none"
    context = {
        "dashboard_period_pill": pill,
        "last_standalone_question": last_standalone,
        "history": history[-10:],
        "user_message": text,
    }
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
    ]
    try:
        raw = await llm_service.complete_json(messages, max_tokens=400, temperature=0.1)
        standalone = str(raw.get("standalone") or text).strip()
        if standalone:
            logger.info("Standalone rephrase: %r → %r", text[:120], standalone[:120])
            return standalone
    except LLMServiceError:
        raise
    except Exception:
        logger.exception("Standalone rephrase failed — using raw message")
    return text
