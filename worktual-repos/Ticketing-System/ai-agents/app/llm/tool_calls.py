"""Normalize OpenAI-compatible tool_calls into {id, name, arguments}."""

from __future__ import annotations

import json
from typing import Any


def _parse_arguments(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"_raw": text}
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    return {"value": raw}


def normalize_tool_calls(raw: Any) -> list[dict[str, Any]]:
    """
    Convert provider tool_calls into a list of:
      {id, name, arguments: dict}
    Accepts OpenAI message.tool_calls or already-normalized LangChain-style calls.
    """
    if not raw:
        return []
    items = list(raw) if isinstance(raw, (list, tuple)) else [raw]
    out: list[dict[str, Any]] = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            # Duck-type objects with name / args / id
            name = getattr(item, "name", None)
            args = getattr(item, "args", None)
            if args is None:
                args = getattr(item, "arguments", None)
            call_id = getattr(item, "id", None) or f"call_{i}"
            if name:
                out.append(
                    {
                        "id": str(call_id),
                        "name": str(name),
                        "arguments": _parse_arguments(args),
                    }
                )
            continue

        # OpenAI: {id, type, function: {name, arguments}}
        fn = item.get("function") if isinstance(item.get("function"), dict) else None
        if fn:
            out.append(
                {
                    "id": str(item.get("id") or f"call_{i}"),
                    "name": str(fn.get("name") or ""),
                    "arguments": _parse_arguments(fn.get("arguments")),
                }
            )
            continue

        # LangChain-style: {id, name, args|arguments}
        name = item.get("name")
        if name:
            args = item.get("arguments")
            if args is None:
                args = item.get("args")
            out.append(
                {
                    "id": str(item.get("id") or f"call_{i}"),
                    "name": str(name),
                    "arguments": _parse_arguments(args),
                }
            )
    return [c for c in out if c.get("name")]


def arguments_as_json_string(arguments: dict[str, Any] | str | None) -> str:
    if isinstance(arguments, str):
        return arguments
    return json.dumps(arguments or {})
