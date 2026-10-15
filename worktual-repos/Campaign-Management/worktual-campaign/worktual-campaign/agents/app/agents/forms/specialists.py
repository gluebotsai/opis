"""Internal Fields / Theme / Design specialists (LLM sub-calls, not shown to user)."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from app.agents.forms.prompts import (
    DESIGN_SPECIALIST_PROMPT,
    FIELDS_SPECIALIST_PROMPT,
    THEME_SPECIALIST_PROMPT,
)
from app.agents.forms.tools.handlers import (
    apply_form_design,
    default_form_design,
    update_form_fields,
    update_form_theme,
)
from app.config import get_settings
from app.llm import (
    CHAT_LLM_TIMEOUT_S,
    FORMS_CHAT_MAX_TOKENS,
    FORMS_CHAT_REASONING_EFFORT,
    LLM_UNAVAILABLE_REPLY,
    OpenAILLM,
)
from app.session_store import get_or_create_session

_SPECIALIST_TIMEOUT_SEC = CHAT_LLM_TIMEOUT_S
_JSON_BLOCK = re.compile(r"\{[\s\S]*\}")


def _llm() -> OpenAILLM:
    s = get_settings()
    return OpenAILLM(
        api_key=s.llm_api_key,
        model_name=s.llm_model,
        base_url=s.llm_base_url,
    )


def _extract_json(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        pass
    m = _JSON_BLOCK.search(raw)
    if not m:
        return {}
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def _specialist_json(
    system_prompt: str,
    instruction: str,
    context: dict[str, Any],
    *,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    llm = _llm()
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                "Current form design JSON:\n"
                + json.dumps(context, indent=2)
                + "\n\nUser instruction:\n"
                + instruction.strip()
                + "\n\nReturn ONLY the JSON object."
            ),
        },
    ]
    result = await asyncio.wait_for(
        asyncio.to_thread(
            llm.run,
            messages,
            [],  # specialists return JSON in content — no nested tools
            FORMS_CHAT_REASONING_EFFORT,
            max_tokens or FORMS_CHAT_MAX_TOKENS,
        ),
        timeout=_SPECIALIST_TIMEOUT_SEC,
    )
    return _extract_json(result.get("content") or "")


async def _current_design(session_id: str, token: str) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token, module="forms")
    return dict(session.get("form_design") or default_form_design())


async def run_theme_specialist(
    session_id: str,
    token: str,
    instruction: str,
    event_callback=None,
) -> dict[str, Any]:
    instruction = (instruction or "").strip()
    if not instruction:
        return {"ok": False, "error": "instruction required"}
    current = await _current_design(session_id, token)
    try:
        payload = await _specialist_json(
            THEME_SPECIALIST_PROMPT,
            instruction,
            {"theme": current.get("theme") or {}},
            max_tokens=512,
        )
    except (asyncio.TimeoutError, Exception):  # noqa: BLE001
        return {"ok": False, "error": LLM_UNAVAILABLE_REPLY}
    if not payload:
        return {"ok": False, "error": "Theme specialist returned no JSON."}
    if not payload.get("change_summary"):
        payload["change_summary"] = f"Updated theme: {instruction[:120]}"
    return await update_form_theme(
        session_id, token, payload, event_callback=event_callback
    )


async def run_fields_specialist(
    session_id: str,
    token: str,
    instruction: str,
    event_callback=None,
) -> dict[str, Any]:
    instruction = (instruction or "").strip()
    if not instruction:
        return {"ok": False, "error": "instruction required"}
    current = await _current_design(session_id, token)
    try:
        payload = await _specialist_json(
            FIELDS_SPECIALIST_PROMPT,
            instruction,
            {
                "title": current.get("title"),
                "description": current.get("description"),
                "thank_you_message": current.get("thank_you_message"),
                "fields": current.get("fields") or [],
            },
            max_tokens=1024,
        )
    except (asyncio.TimeoutError, Exception):  # noqa: BLE001
        return {"ok": False, "error": LLM_UNAVAILABLE_REPLY}
    if not payload:
        return {"ok": False, "error": "Fields specialist returned no JSON."}
    if not payload.get("change_summary"):
        payload["change_summary"] = f"Updated fields: {instruction[:120]}"
    return await update_form_fields(
        session_id, token, payload, event_callback=event_callback
    )


async def run_design_specialist(
    session_id: str,
    token: str,
    instruction: str,
    event_callback=None,
) -> dict[str, Any]:
    instruction = (instruction or "").strip()
    if not instruction:
        return {"ok": False, "error": "instruction required"}
    current = await _current_design(session_id, token)
    try:
        payload = await _specialist_json(
            DESIGN_SPECIALIST_PROMPT,
            instruction,
            current,
            max_tokens=FORMS_CHAT_MAX_TOKENS,
        )
    except (asyncio.TimeoutError, Exception):  # noqa: BLE001
        return {"ok": False, "error": LLM_UNAVAILABLE_REPLY}
    if not payload:
        return {"ok": False, "error": "Design specialist returned no JSON."}
    if not payload.get("change_summary"):
        payload["change_summary"] = f"Redesigned form: {instruction[:120]}"
    # Merge missing pieces from current so partial JSON still applies cleanly.
    if "fields" not in payload:
        payload["fields"] = current.get("fields")
    if "theme" not in payload:
        payload["theme"] = current.get("theme")
    if "title" not in payload:
        payload["title"] = current.get("title")
    return await apply_form_design(
        session_id, token, payload, event_callback=event_callback
    )
