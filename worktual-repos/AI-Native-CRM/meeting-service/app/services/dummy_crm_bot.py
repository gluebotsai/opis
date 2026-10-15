from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException
from openai import OpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import Meeting, TranscriptSegment

log = logging.getLogger(__name__)

SYSTEM = """You are a sales assist copilot for a live CRM meeting.
Answer only from the transcript and the question. If the transcript does not contain the answer, say you do not know yet.
Be concise. Do not invent CRM facts, prices, or commitments.
"""


def _transcript_text(db: Session, meeting_id: str) -> str:
    segs = db.scalars(
        select(TranscriptSegment)
        .where(TranscriptSegment.meeting_id == meeting_id, TranscriptSegment.completed == 1)
        .order_by(TranscriptSegment.t0, TranscriptSegment.id)
    ).all()
    segs = segs[-80:]
    return "\n".join(f"{(s.speaker or 'Unknown')}: {s.text}" for s in segs if (s.text or "").strip())


def _openai_client() -> OpenAI:
    base = (settings.crm_bot_openai_base_url or "").rstrip("/")
    if not base:
        raise HTTPException(status_code=503, detail="CRM bot is not configured")
    return OpenAI(
        base_url=base,
        api_key=settings.crm_bot_openai_api_key or "EMPTY",
        timeout=settings.llm_timeout_sec,
    )


def reply(payload: dict[str, Any], db: Session | None = None) -> dict:
    meeting_id = str(payload.get("meeting_id") or "")
    org_id = str(payload.get("organization_id") or "")
    close = False
    if db is None:
        db = SessionLocal()
        close = True
    try:
        meeting = db.get(Meeting, meeting_id) if meeting_id else None
        if not meeting or (org_id and meeting.org_id != org_id):
            raise HTTPException(status_code=404, detail="meeting not found")
        text = _transcript_text(db, meeting.id)
    finally:
        if close:
            db.close()

    user = payload.get("user") or {}
    who = user.get("email") or user.get("crm_sub") or "unknown"
    query = str(payload.get("query") or "").strip()
    intent = payload.get("intent") or "ask"
    entity = f"{payload.get('entity_type') or ''} {payload.get('entity_id') or ''}".strip()
    model = settings.crm_bot_openai_model or ""
    is_gemma = "gemma" in model.strip().lower()
    create_kwargs: dict[str, Any] = {
        "model": model,
        "temperature": 0.35 if is_gemma else 0.3,
        "messages": [
                {"role": "system", "content": SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Salesperson: {who}\n"
                        f"CRM entity: {entity or 'unknown'}\n"
                        f"Intent: {intent}\n"
                        f"Question: {query}\n\n"
                        f"Transcript:\n{text or '(no transcript yet)'}"
                    ),
                },
            ],
    }
    if is_gemma:
        create_kwargs["extra_body"] = {
            "top_k": 60,
            "repetition_penalty": 1.0,
            "chat_template_kwargs": {"enable_thinking": False},
        }
    try:
        client = _openai_client()
        response = client.chat.completions.create(**create_kwargs)
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("dummy_crm_bot_llm_failed", extra={"error": type(exc).__name__})
        raise HTTPException(status_code=502, detail="dummy CRM bot LLM failed") from exc

    content = ""
    if response.choices and response.choices[0].message:
        content = response.choices[0].message.content or ""
    return {"reply": content.strip(), "source": "dummy"}
