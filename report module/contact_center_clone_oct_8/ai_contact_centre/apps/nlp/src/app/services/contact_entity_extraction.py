"""LLM-only contact entity extraction shared by API and support bot."""

from __future__ import annotations

import logging
from typing import Any

from app.llm.client import LLMClient
from app.llm.providers import parse_json_object
from app.prompts.contact_identity import CONTACT_ENTITY_PROMPT
from app.schemas.bot import ContactEntities

logger = logging.getLogger("nlp.contact_entity_extraction")

CONTACT_ENTITY_JSON_HINT = """
Return one JSON object with this exact shape:
{
  "contact_entities": {
    "email": string | null,
    "phone": string | null,
    "first_name": string | null,
    "last_name": string | null,
    "company": string | null,
    "city": string | null,
    "country": string | null
  }
}
Use null for unknown fields. Never invent values. Return JSON only — no markdown or prose.
"""


def _build_user_block(
    message: str,
    *,
    transcript: list[dict[str, Any]] | None = None,
    channel: str = "webchat",
) -> str:
    context_lines: list[str] = []
    if transcript:
        for item in transcript[-8:]:
            role = str(item.get("role") or "user").strip().lower()
            content = str(item.get("content") or "").strip()
            if content:
                context_lines.append(f"{role}: {content}")

    user_block = message.strip()
    if context_lines:
        user_block = (
            "Recent transcript:\n"
            + "\n".join(context_lines)
            + "\n\nLatest customer message:\n"
            + user_block
        )
    return f"Channel: {channel}\n{user_block}"


def _messages_for_extraction(user_block: str, *, strict: bool = False) -> list[dict[str, str]]:
    suffix = (
        "\n\nIMPORTANT: Respond with a single JSON object only."
        if strict
        else ""
    )
    return [
        {
            "role": "system",
            "content": CONTACT_ENTITY_PROMPT + "\n" + CONTACT_ENTITY_JSON_HINT + suffix,
        },
        {"role": "user", "content": user_block},
    ]


async def _extract_payload(
    llm: LLMClient,
    user_block: str,
    *,
    strict: bool = False,
) -> dict[str, Any]:
    messages = _messages_for_extraction(user_block, strict=strict)
    try:
        return await llm.json(messages)
    except Exception:
        response = await llm.complete(messages)
        return parse_json_object(response.content)


async def extract_contact_entities_llm(
    llm: LLMClient,
    message: str,
    *,
    transcript: list[dict[str, Any]] | None = None,
    channel: str = "webchat",
) -> ContactEntities:
    """Extract customer profile fields from a message using the LLM only."""
    user_block = _build_user_block(message, transcript=transcript, channel=channel)

    try:
        payload = await _extract_payload(llm, user_block, strict=False)
    except Exception as first_error:
        logger.warning("contact entity extraction first attempt failed: %s", first_error)
        payload = await _extract_payload(llm, user_block, strict=True)

    raw = payload.get("contact_entities", payload)
    return ContactEntities.model_validate(raw)
