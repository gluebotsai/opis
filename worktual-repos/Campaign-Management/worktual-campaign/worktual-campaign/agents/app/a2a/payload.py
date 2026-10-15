"""Flatten Hub JSON-RPC message parts into a Super Agent task payload."""

from __future__ import annotations

from typing import Any

from app.a2a.catalog import intent_for_skill
from app.config import get_settings


def _instruction_to_request_text(instruction: Any) -> str:
    if isinstance(instruction, dict):
        return str(
            instruction.get("description")
            or instruction.get("query")
            or instruction.get("text")
            or ""
        ).strip()
    if isinstance(instruction, str):
        return instruction.strip()
    return ""


def _apply_instruction_as_request_text(
    payload: dict[str, Any], data: dict[str, Any]
) -> None:
    """Map Hub `instruction` → `request_text` (top-level data or nested arguments)."""
    args = data.get("arguments") if isinstance(data.get("arguments"), dict) else {}
    for source in (data, payload, args):
        if not isinstance(source, dict):
            continue
        instruction = source.get("instruction")
        text = _instruction_to_request_text(instruction)
        if text and not str(payload.get("request_text") or "").strip():
            payload["request_text"] = text
        if isinstance(instruction, dict) and instruction.get("actionType"):
            payload.setdefault("action", instruction.get("actionType"))


def _merge_hub_arguments(payload: dict[str, Any], data: dict[str, Any]) -> None:
    """Hub often nests skill fields under data.arguments — hoist for sub-agents."""
    args = data.get("arguments")
    if not isinstance(args, dict):
        return
    for key, val in args.items():
        if val is None or val == "":
            continue
        if key not in payload or payload.get(key) in (None, "", [], {}):
            payload[key] = val
    if args.get("email") and not payload.get("emails"):
        em = str(args.get("email") or "").strip().lower()
        if em:
            payload.setdefault("emails", [em])


def _first_data_part(message: dict[str, Any]) -> dict[str, Any]:
    parts = message.get("parts") if isinstance(message.get("parts"), list) else []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if str(part.get("kind") or "").lower() == "data" and isinstance(
            part.get("data"), dict
        ):
            return dict(part["data"])
        if isinstance(part.get("data"), dict):
            return dict(part["data"])
    return {}


def flatten_hub_message(params: dict[str, Any]) -> dict[str, Any]:
    message = params.get("message") if isinstance(params.get("message"), dict) else {}
    data = _first_data_part(message)
    metadata = (
        message.get("metadata")
        if isinstance(message.get("metadata"), dict)
        else {}
    )
    # Normalize camelCase / snake_case
    organization_id = str(
        data.get("organizationId")
        or data.get("organization_id")
        or metadata.get("organizationId")
        or ""
    ).strip()
    skill_id = str(data.get("skillId") or data.get("skill_id") or "").strip()
    source = str(data.get("source") or metadata.get("source") or "").strip().lower()
    cdp_id = str(data.get("cdpId") or data.get("cdp_id") or "").strip()

    intent = intent_for_skill(skill_id)
    payload = dict(data)
    _merge_hub_arguments(payload, data)
    # Drop envelope keys from payload copy used by sub-agents
    for key in (
        "skillId",
        "skill_id",
        "source",
        "organizationId",
        "organization_id",
        "arguments",
    ):
        payload.pop(key, None)

    if cdp_id:
        payload.setdefault("cdp_id", cdp_id)
        # Prefer as contact id when hub only sends cdpId
        ids = list(payload.get("contact_ids") or payload.get("customer_ids") or [])
        if cdp_id not in [str(x) for x in ids]:
            ids.append(cdp_id)
        payload["contact_ids"] = ids
        payload["customer_ids"] = ids

    _apply_instruction_as_request_text(payload, data)

    return {
        "skill_id": skill_id,
        "intent": intent,
        "source": source or "hub",
        "organization_id": organization_id,
        "cdp_id": cdp_id,
        "payload": payload,
        "message_id": str(message.get("messageId") or message.get("message_id") or ""),
        "raw_data": data,
    }


def resolve_campaign_api_token(flat: dict[str, Any]) -> str:
    """Token for Campaign REST calls during skill execution.

    Prefer Hub campaignToken when present; else A2A_CAMPAIGN_API_TOKEN.
    When both are empty, callers should use resolve_campaign_api_bearer()
    which mints a SPA JWT from organizationId (Hub need not send a token).
    """
    payload = flat.get("payload") if isinstance(flat.get("payload"), dict) else {}
    for key in ("campaignToken", "campaign_token", "accessToken", "api_token"):
        val = str(payload.get(key) or flat.get("raw_data", {}).get(key) or "").strip()
        if val:
            return val
    return str(get_settings().a2a_campaign_api_token or "").strip()
