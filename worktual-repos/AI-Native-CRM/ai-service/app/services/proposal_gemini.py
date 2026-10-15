"""Native Gemini client for proposal extract/generate only.

Coworker and other CRM agents stay on the OpenAI-compatible ``LLM_*`` path.
Paid google-genai uses Chat.send_message + JSON schema (not Models.generate_content).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, TypeVar

from pydantic import BaseModel

from app.config import get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# HttpOptions.timeout is milliseconds (google-genai). Align with Fastify 240s cap.
PROPOSAL_GEMINI_TIMEOUT_MS = 180_000
# Thinking + JSON body share this budget. 8192 leaves MAX_TOKENS mid-string (~80 chars).
PROPOSAL_GEMINI_MAX_OUTPUT_TOKENS = 65_536
DEFAULT_MODEL = "gemini-3.5-flash"
DEFAULT_THINKING_LEVEL = "high"

GEMINI_UNAVAILABLE_REASON = "gemini_unavailable"
GEMINI_UNAVAILABLE_MESSAGE = (
    "Gemini is temporarily unavailable due to high demand. "
    "Retry in a few minutes."
)


def proposal_gemini_configured() -> bool:
    s = get_settings()
    key = _api_key(s)
    model = (s.proposal_llm_model or DEFAULT_MODEL).strip()
    return bool(key and key.upper() != "EMPTY" and model)


def _api_key(settings: Any | None = None) -> str:
    s = settings or get_settings()
    for raw in (getattr(s, "proposal_llm_api_key", ""), getattr(s, "gemini_api_key", "")):
        key = str(raw or "").strip()
        if key and key.upper() != "EMPTY":
            return key
    return ""


def _scrub_schema(node: Any) -> None:
    if isinstance(node, dict):
        node.pop("additionalProperties", None)
        node.pop("title", None)
        for value in list(node.values()):
            _scrub_schema(value)
    elif isinstance(node, list):
        for item in node:
            _scrub_schema(item)


def gemini_schema(schema: type[BaseModel]) -> dict[str, Any]:
    raw = schema.model_json_schema()
    _scrub_schema(raw)
    return raw


def format_gemini_error(exc: BaseException) -> str:
    raw = str(exc).replace("\x00", " ").replace("\r", " ")
    return " ".join(raw.split())[:240]


def is_gemini_unavailable(exc: BaseException | str) -> bool:
    """True for provider capacity errors (503 high demand / 429). Do not walk remaining leaves."""
    blob = str(exc)
    lower = blob.lower()
    if "high demand" in lower:
        return True
    if "resource_exhausted" in lower or "resource exhausted" in lower:
        return True
    if re.search(r"\b429\b", blob):
        return True
    if re.search(r"\b503\b", blob) and "unavailable" in lower:
        return True
    return False


def resolve_thinking_level(level: str | None) -> str:
    wanted = (level or DEFAULT_THINKING_LEVEL).strip().lower() or DEFAULT_THINKING_LEVEL
    if wanted not in {"minimal", "low", "medium", "high"}:
        return DEFAULT_THINKING_LEVEL
    return wanted


def thinking_config_kwargs(level: str = DEFAULT_THINKING_LEVEL) -> dict[str, Any]:
    """Return GenerateContentConfig thinking kwargs. Exposed for tests."""
    wanted = resolve_thinking_level(level)
    try:
        from google.genai import types
    except ImportError:
        return {
            "thinking_config": {
                "thinking_level": wanted,
                "include_thoughts": False,
            }
        }

    ThinkingConfig = getattr(types, "ThinkingConfig", None)
    if ThinkingConfig is None:
        return {}
    try:
        return {
            "thinking_config": ThinkingConfig(
                thinking_level=wanted,
                include_thoughts=False,
            )
        }
    except Exception:  # noqa: BLE001 — older SDKs only accept thinking_budget
        budget = -1 if wanted in {"high", "medium"} else 0
        if wanted == "low":
            budget = 1024
        try:
            return {"thinking_config": ThinkingConfig(thinking_budget=budget)}
        except Exception:  # noqa: BLE001
            return {}


def _part_is_thought(part: Any) -> bool:
    if isinstance(part, dict):
        return bool(part.get("thought"))
    return bool(getattr(part, "thought", False))


def _part_text(part: Any) -> str:
    piece = getattr(part, "text", None)
    if piece is None and isinstance(part, dict):
        piece = part.get("text")
    return str(piece or "")


def _dump_parsed(parsed: Any) -> str:
    if parsed is None:
        return ""
    if isinstance(parsed, BaseModel):
        return parsed.model_dump_json()
    dump = getattr(parsed, "model_dump", None)
    if callable(dump):
        try:
            return json.dumps(dump(), ensure_ascii=False)
        except TypeError:
            pass
    if isinstance(parsed, (dict, list)):
        return json.dumps(parsed, ensure_ascii=False)
    return ""


def extract_json_object(raw: str) -> str:
    """Keep the first complete JSON object; drop thought/prose prefixes."""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    start = text.find("{")
    if start < 0:
        return text
    depth = 0
    in_str = False
    escape = False
    for i, ch in enumerate(text[start:], start):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return text[start:]


def finish_reason_name(response: Any) -> str:
    for cand in getattr(response, "candidates", None) or []:
        reason = getattr(cand, "finish_reason", None)
        if reason is None and isinstance(cand, dict):
            reason = cand.get("finish_reason")
        if reason is None:
            continue
        return str(getattr(reason, "name", None) or getattr(reason, "value", None) or reason)
    return ""


def response_text(response: Any) -> str:
    """Visible JSON only — skip thought parts; prefer SDK ``parsed``."""
    dumped = _dump_parsed(getattr(response, "parsed", None))
    if dumped:
        return dumped
    chunks: list[str] = []
    for cand in getattr(response, "candidates", None) or []:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            if _part_is_thought(part):
                continue
            piece = _part_text(part)
            if piece:
                chunks.append(piece)
    if chunks:
        return "\n".join(chunks).strip()
    return str(getattr(response, "text", None) or "").strip()


def _http_options(types_mod: Any) -> Any | None:
    """Timeout must be milliseconds. Passing seconds (180) looks like 180ms to the API."""
    HttpOptions = getattr(types_mod, "HttpOptions", None)
    if HttpOptions is None:
        return None
    try:
        return HttpOptions(timeout=int(PROPOSAL_GEMINI_TIMEOUT_MS))
    except (TypeError, ValueError):
        return None


def _parse_schema_json(raw: str, schema: type[T], *, finish_reason: str = "") -> T:
    raw = extract_json_object(raw)
    if not raw:
        raise RuntimeError("Gemini returned empty JSON")
    try:
        return schema.model_validate_json(raw)
    except Exception:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            reason = finish_reason or "unknown"
            raise RuntimeError(
                f"Gemini JSON incomplete ({reason}): {exc}"
            ) from exc
        return schema.model_validate(parsed)


def _generate_json_openai_compat(
    prompt: str,
    schema: type[T],
    *,
    extra_text: str = "",
    thinking_level: str | None = None,
) -> T:
    """Fallback when google-genai is not installed. Uses PROPOSAL_LLM_BASE_URL."""
    from openai import OpenAI

    s = get_settings()
    model = (s.proposal_llm_model or DEFAULT_MODEL).strip()
    base = (s.proposal_llm_base_url or "").strip().rstrip("/")
    if not base:
        raise RuntimeError("proposal_gemini_not_configured")
    schema_json = json.dumps(gemini_schema(schema), ensure_ascii=False)[:12_000]
    user = (
        f"{prompt}\n\nReturn JSON matching this schema:\n{schema_json}"
    )
    if extra_text.strip():
        user += f"\n\n--- ADDITIONAL EXTRACTED TEXT ---\n{extra_text.strip()[:28000]}"
    client = OpenAI(
        api_key=_api_key(s),
        base_url=base,
        timeout=PROPOSAL_GEMINI_TIMEOUT_MS / 1000.0,
    )
    level = resolve_thinking_level(
        thinking_level or getattr(s, "proposal_llm_thinking_level", None)
    )
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "Return ONLY valid JSON matching the requested schema.",
            },
            {"role": "user", "content": user},
        ],
        "temperature": 0,
        "max_tokens": PROPOSAL_GEMINI_MAX_OUTPUT_TOKENS,
    }
    try:
        response = client.chat.completions.create(
            **kwargs,
            extra_body={"thinking_config": {"thinking_level": level}},
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("proposal Gemini extra_body rejected; retrying plain JSON: %s", exc)
        response = client.chat.completions.create(**kwargs)
    raw = (response.choices[0].message.content or "").strip()
    return _parse_schema_json(raw, schema)


def generate_json_sync(
    prompt: str,
    schema: type[T],
    *,
    pdf_bytes: list[bytes] | None = None,
    image_bytes: list[tuple[bytes, str]] | None = None,
    extra_text: str = "",
    thinking_level: str | None = None,
) -> T:
    if not proposal_gemini_configured():
        raise RuntimeError("proposal_gemini_not_configured")

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        logger.warning("google-genai not installed; using OpenAI-compat Gemini JSON")
        return _generate_json_openai_compat(
            prompt,
            schema,
            extra_text=extra_text,
            thinking_level=thinking_level,
        )

    s = get_settings()
    model = (s.proposal_llm_model or DEFAULT_MODEL).strip()
    parts: list[Any] = []
    for blob in pdf_bytes or []:
        if blob:
            parts.append(types.Part.from_bytes(data=blob, mime_type="application/pdf"))
    for blob, mime in image_bytes or []:
        if blob:
            parts.append(
                types.Part.from_bytes(
                    data=blob,
                    mime_type=mime or "image/png",
                )
            )
    text = prompt
    if extra_text.strip():
        text = f"{prompt}\n\n--- ADDITIONAL EXTRACTED TEXT ---\n{extra_text.strip()}"
    parts.append(text)

    thinking_level = resolve_thinking_level(
        thinking_level
        if thinking_level is not None
        else getattr(s, "proposal_llm_thinking_level", None)
    )
    schema_obj = gemini_schema(schema)
    http_options = _http_options(types)
    client = (
        genai.Client(api_key=_api_key(s), http_options=http_options)
        if http_options is not None
        else genai.Client(api_key=_api_key(s))
    )

    config_kwargs: dict[str, Any] = {
        "temperature": 0,
        "max_output_tokens": PROPOSAL_GEMINI_MAX_OUTPUT_TOKENS,
        "response_mime_type": "application/json",
        "response_schema": schema_obj,
    }
    Afc = getattr(types, "AutomaticFunctionCallingConfig", None)
    if Afc is not None:
        try:
            config_kwargs["automatic_function_calling"] = Afc(disable=True)
        except Exception:  # noqa: BLE001
            pass
    config_kwargs.update(thinking_config_kwargs(thinking_level))
    config = types.GenerateContentConfig(**config_kwargs)
    # Paid SDK: structured JSON + thinking on Chat.send_message (not Models.generate_content).
    chat = client.chats.create(model=model)
    response = chat.send_message(parts, config=config)
    return _parse_schema_json(
        response_text(response),
        schema,
        finish_reason=finish_reason_name(response),
    )


async def generate_json(
    prompt: str,
    schema: type[T],
    *,
    pdf_bytes: list[bytes] | None = None,
    image_bytes: list[tuple[bytes, str]] | None = None,
    extra_text: str = "",
    thinking_level: str | None = None,
) -> T:
    return await asyncio.to_thread(
        generate_json_sync,
        prompt,
        schema,
        pdf_bytes=pdf_bytes,
        image_bytes=image_bytes,
        extra_text=extra_text,
        thinking_level=thinking_level,
    )
