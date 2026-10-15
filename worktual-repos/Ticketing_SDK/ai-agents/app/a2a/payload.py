"""Flatten Hub message/send parts into dispatch kwargs."""

from __future__ import annotations

import json
from typing import Any


class PayloadError(Exception):
    def __init__(self, message: str, *, missing: list[str] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.missing = missing or []


def _merge_dicts(items: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for item in items:
        if isinstance(item, dict):
            out.update(item)
    return out


def flatten_message_parts(message: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(message, dict):
        raise PayloadError("message is required")
    parts = message.get("parts")
    if not isinstance(parts, list):
        raise PayloadError("message.parts must be a list")
    data_parts: list[dict[str, Any]] = []
    text_parts: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        kind = str(part.get("kind") or "").strip().lower()
        if kind == "data" and isinstance(part.get("data"), dict):
            data_parts.append(part["data"])
        elif kind == "text":
            text_parts.append(str(part.get("text") or "").strip())
    merged = _merge_dicts(data_parts)
    if text_parts and "instruction" not in merged:
        merged["instruction"] = "\n".join(t for t in text_parts if t)
    return merged


def _pick(data: dict[str, Any], *keys: str) -> str:
    for key in keys:
        val = data.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    return ""


def parse_hub_payload(raw: dict[str, Any]) -> dict[str, Any]:
    source = _pick(raw, "source")
    if source != "hub":
        raise PayloadError("source must be 'hub'")
    org = _pick(raw, "organizationId", "organization_id")
    skill = _pick(raw, "skillId", "skill_id")
    if not org:
        raise PayloadError("organizationId is required", missing=["organizationId"])
    if not skill:
        raise PayloadError("skillId is required", missing=["skillId"])
    cdp_id = _pick(raw, "cdpId", "cdp_id")
    instruction = raw.get("instruction")
    channel = _pick(raw, "channel") or "chat"
    if channel not in ("chat", "email"):
        channel = "chat"
    return {
        "source": source,
        "organization_id": org,
        "skill_id": skill.lower(),
        "cdp_id": cdp_id or None,
        "instruction": instruction,
        "channel": channel,
        "raw": raw,
    }


def instruction_text(instruction: Any) -> str:
    if instruction is None:
        return ""
    if isinstance(instruction, str):
        return instruction.strip()
    if isinstance(instruction, dict):
        for key in ("description", "text", "query", "message", "body"):
            val = instruction.get(key)
            if val is not None and str(val).strip():
                return str(val).strip()
        try:
            return json.dumps(instruction, separators=(",", ":"), sort_keys=True)
        except (TypeError, ValueError):
            return str(instruction)
    return str(instruction).strip()


def focused_entity_from_cdp(cdp_id: str | None) -> dict[str, Any] | None:
    cdp = str(cdp_id or "").strip()
    if not cdp:
        return None
    return {"type": "customer", "cdp_id": cdp}
