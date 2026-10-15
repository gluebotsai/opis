"""Normalize OpenAI-compatible tool_calls into {id, name, arguments}."""

from __future__ import annotations

import json
import re
from typing import Any

# Gemma / worktual-gemma-cx sometimes emits tools as prose instead of bind_tools.
_TOOL_NAME_ALIASES = {
    "create_team": "create_queue",
    "create_kb": "create_kb_article",
}

_INLINE_CALL_HEAD_RE = re.compile(
    r"(?is)call:(?:[\w.-]+:)*([a-z][\w-]*)",
)
_XML_TOOL_CALLS_RE = re.compile(
    r"(?is)<\s*tool_calls\s*>\s*(.*?)\s*<\s*/\s*tool_calls\s*>",
)


_TOOL_ARG_WRAPPER_KEYS = frozenset(
    {"arguments", "args", "idempotency_key", "_idempotency_key", "name", "id", "type"}
)
_TOOL_ARG_SENTINELS = frozenset({"", "null", "none"})


def flatten_tool_arguments(raw: Any) -> dict[str, Any]:
    """Unwrap Gemma double-wrapped tool payloads before schema/confirm gates.

    Server models sometimes emit ``{arguments: {status, confirmed}, idempotency_key: "null"}``
    instead of a flat write object. That is argument-shape repair, not intent.
    """
    out = dict(raw) if isinstance(raw, dict) else {}
    inner: Any = out.get("arguments")
    if inner is None:
        inner = out.get("args")
    if isinstance(inner, str):
        text = inner.strip()
        if text:
            try:
                loaded = json.loads(text)
            except json.JSONDecodeError:
                loaded = None
            if isinstance(loaded, dict):
                inner = loaded
    if isinstance(inner, dict):
        siblings = {
            key: value
            for key, value in out.items()
            if key not in {"arguments", "args"}
            and key not in _TOOL_ARG_WRAPPER_KEYS
            and str(value or "").strip().lower() not in _TOOL_ARG_SENTINELS
        }
        out = {**inner, **siblings}
    for junk in ("idempotency_key", "_idempotency_key"):
        value = str(out.get(junk) or "").strip().lower()
        if value in _TOOL_ARG_SENTINELS:
            out.pop(junk, None)
    atts = out.get("attachments")
    if isinstance(atts, str):
        text = atts.strip()
        loaded: Any = None
        if text.startswith("["):
            try:
                loaded = json.loads(text)
            except json.JSONDecodeError:
                loaded = None
        if isinstance(loaded, list):
            out["attachments"] = loaded
        elif text.startswith("/uploads/"):
            out["attachments"] = [text]
        else:
            out.pop("attachments", None)
    return out


def _parse_arguments(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return flatten_tool_arguments(raw)
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"_raw": text}
        if isinstance(parsed, dict):
            return flatten_tool_arguments(parsed)
        return {"value": parsed}
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


def normalize_gemma_tool_leak_text(text: str) -> str:
    """Strip Gemma channel/tool markers and quote tokens from prose tool leaks."""
    t = (text or "").strip()
    if not t:
        return ""
    t = re.sub(r"(?is)<\|?tool_call\|?>|<tool_call\|>", "", t)
    t = t.replace('<|"|>', '"')
    t = re.sub(r"(?is)<\|?channel\|?>|<channel\|>", "", t)
    return t.strip()


def _parse_inline_value(raw: str) -> Any:
    v = raw.strip().rstrip(",").strip()
    if not v:
        return ""
    lower = v.lower()
    if lower == "true":
        return True
    if lower == "false":
        return False
    if v.startswith("[") and v.endswith("]"):
        try:
            parsed = json.loads(v)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            inner = v[1:-1].strip()
            if not inner:
                return []
            return [
                part.strip().strip('"').strip("'")
                for part in inner.split(",")
                if part.strip()
            ]
    if len(v) >= 2 and v[0] == v[-1] and v[0] in {"'", '"'}:
        return v[1:-1]
    if v.isdigit():
        return int(v)
    return v


def _parse_inline_kwargs(blob: str) -> dict[str, Any]:
    raw = (blob or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw if raw.startswith("{") else "{" + raw + "}")
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    out: dict[str, Any] = {}
    keys = list(re.finditer(r"([A-Za-z_][A-Za-z0-9_]*)\s*:", raw))
    for i, match in enumerate(keys):
        start = match.end()
        end = keys[i + 1].start() if i + 1 < len(keys) else len(raw)
        out[match.group(1)] = _parse_inline_value(raw[start:end])
    return out


def _extract_inline_call_blob(text: str) -> tuple[str, str] | None:
    """Return (tool_name, args_blob) from balanced `{…}` after call:agent:tool."""
    norm = normalize_gemma_tool_leak_text(text)
    if not norm or "call:" not in norm.lower():
        return None
    match = _INLINE_CALL_HEAD_RE.search(norm)
    if not match:
        return None
    name = _TOOL_NAME_ALIASES.get(
        match.group(1).strip().lower(),
        match.group(1).strip().lower(),
    )
    idx = match.end()
    while idx < len(norm) and norm[idx].isspace():
        idx += 1
    if idx >= len(norm) or norm[idx] != "{":
        return None
    depth = 0
    start = idx
    for i in range(idx, len(norm)):
        ch = norm[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return name, norm[start + 1 : i]
    return None


def _alias_kb_write_args(name: str, args: dict[str, Any]) -> dict[str, Any]:
    if name in {"create_kb_article", "draft_kb_article"} and not args.get("content"):
        if args.get("body"):
            args["content"] = args.get("body")
    return args


def _json_tool_calls_from_content(text: str | None) -> list[dict[str, Any]]:
    """Parse `<tool_calls>[{name, arguments}]</tool_calls>` model leaks (not user intent)."""
    raw = str(text or "").strip()
    if not raw:
        return []
    blobs: list[str] = [match.group(1).strip() for match in _XML_TOOL_CALLS_RE.finditer(raw)]
    if not blobs:
        stripped = raw
        if stripped.startswith("[") and '"name"' in stripped:
            blobs.append(stripped)
        elif stripped.startswith("{") and '"name"' in stripped:
            blobs.append(stripped)
    out: list[dict[str, Any]] = []
    for i, blob in enumerate(blobs):
        try:
            loaded = json.loads(blob)
        except json.JSONDecodeError:
            continue
        for j, call in enumerate(normalize_tool_calls(loaded)):
            name = str(call.get("name") or "").strip()
            args = dict(call.get("arguments") or {})
            call["id"] = f"call_xml_{i}_{j}"
            call["arguments"] = _alias_kb_write_args(name, args)
            out.append(call)
    return out


def inline_tool_calls_from_content(text: str | None) -> list[dict[str, Any]]:
    """
    Parse Gemma prose tool leaks into normalized OpenAI-style tool_calls.

    Example leak (not user intent — model output):
      <|tool_call>call:ticketing:update_queue{confirmed:true,...}<tool_call|>
      <tool_calls>[{"name":"patch_kb_draft","arguments":{...}}]</tool_calls>
    """
    xml_calls = _json_tool_calls_from_content(text)
    if xml_calls:
        return xml_calls
    found = _extract_inline_call_blob(str(text or ""))
    if not found:
        return []
    name, args_blob = found
    args = _alias_kb_write_args(name, _parse_inline_kwargs(args_blob))
    return [
        {
            "id": "call_text",
            "name": name,
            "arguments": args,
        }
    ]


def content_looks_like_inline_tool_call(text: str | None) -> bool:
    """True when assistant content is a prose / XML tool invocation leak."""
    if _json_tool_calls_from_content(text):
        return True
    norm = normalize_gemma_tool_leak_text(str(text or ""))
    if not norm or "call:" not in norm.lower():
        return False
    return _extract_inline_call_blob(norm) is not None
