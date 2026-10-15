from __future__ import annotations

import json
import logging
import time

import httpx
from pydantic import ValidationError

from app.config import settings
from app.schemas import LiveTipSchema, MeetingExtractSchema

log = logging.getLogger(__name__)

_circuit_failures = 0
_circuit_open_until = 0.0


def reset_circuit() -> None:
    global _circuit_failures, _circuit_open_until
    _circuit_failures = 0
    _circuit_open_until = 0.0


EXTRACT_PROMPT = """You extract CRM notes from a meeting transcript.
Return JSON only with keys: summary, next_step, action_items, pain_points, products, speakers.
Use empty string or [] when unknown. Do not invent quantities, names, or commitments.
entity_type={entity_type} entity_id={entity_id}
"""

TIP_PROMPT = """From this recent transcript, return JSON:
missing_fields (list), objections (list), suggested_question (string).
Empty lists if unknown. Do not invent facts.
"""


class LlmError(Exception):
    pass


def _trip_circuit() -> None:
    global _circuit_failures, _circuit_open_until
    _circuit_failures += 1
    if _circuit_failures >= settings.llm_circuit_failures:
        _circuit_open_until = time.time() + settings.llm_circuit_open_sec
        log.info("llm_circuit_open", extra={"error_code": "llm_failed"})


def _chat(system: str, user: str) -> str:
    global _circuit_failures
    if time.time() < _circuit_open_until:
        raise LlmError("llm circuit open")
    url = settings.llm_base_url.rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if settings.llm_api_key:
        headers["Authorization"] = f"Bearer {settings.llm_api_key}"
    body = {
        "model": settings.llm_model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
    }
    try:
        with httpx.Client(timeout=settings.llm_timeout_sec) as client:
            r = client.post(url, headers=headers, json=body)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPError as exc:
        _trip_circuit()
        raise LlmError("llm unreachable") from exc
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        _trip_circuit()
        raise LlmError("llm bad response") from exc
    _circuit_failures = 0
    return content


def extract_meeting(transcript: str, entity_type: str, entity_id: str) -> MeetingExtractSchema:
    raw = _chat(EXTRACT_PROMPT.format(entity_type=entity_type, entity_id=entity_id), transcript[:80000])
    try:
        parsed = json.loads(raw)
        return MeetingExtractSchema.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise LlmError("llm invalid json") from exc


def live_tips(transcript: str) -> LiveTipSchema:
    raw = _chat(TIP_PROMPT, transcript[-12000:])
    try:
        parsed = json.loads(raw)
        return LiveTipSchema.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise LlmError("llm invalid json") from exc
