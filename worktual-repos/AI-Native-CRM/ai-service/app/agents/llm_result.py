"""
Shared helpers for LLM-primary agents.

Canonical prompt sections match crm_tools.build_system_prompt:
Role → Goal → Instructions → Context → Output → Guardrails.

PARALLEL B2B/B2C WORK: high-touch shared file - coordinate before editing.
This is a "reuse, don't fork" stack per .cursor/rules/agents-must-use-llm.mdc.
Log changes in docs/parallel-work-log.md (see docs/merge-validation-checklist.md).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

logger = logging.getLogger(__name__)


def sectioned_system_prompt(
    *,
    role: str,
    goal: str,
    instructions: str,
    context: str = "",
    output: str,
    guardrails: str,
) -> str:
    """Build a Role→Goal→Instructions→Context→Output→Guardrails system prompt."""
    parts = [
        f"Role:\n{role.strip()}",
        f"Goal:\n{goal.strip()}",
        f"Instructions:\n{instructions.strip()}",
    ]
    if context and context.strip():
        parts.append(f"Context:\n{context.strip()}")
    parts.append(f"Output:\n{output.strip()}")
    parts.append(f"Guardrails:\n{guardrails.strip()}")
    return "\n\n".join(parts)


def extract_json(text: str) -> dict[str, Any] | None:
    """Parse a JSON object from model text (fenced or raw)."""
    raw = (text or "").strip()
    if not raw:
        return None
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.I)
    if fence:
        raw = fence.group(1).strip()

    def _escape_newlines_in_strings(payload: str) -> str:
        out: list[str] = []
        in_string = False
        escape = False
        for ch in payload:
            if escape:
                out.append(ch)
                escape = False
                continue
            if ch == "\\" and in_string:
                out.append(ch)
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                out.append(ch)
                continue
            if in_string and ch == "\n":
                out.append("\\n")
                continue
            if in_string and ch == "\r":
                continue
            if in_string and ch == "\t":
                out.append("\\t")
                continue
            out.append(ch)
        return "".join(out)

    candidates = [raw]
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        candidates.append(raw[start : end + 1])
    for candidate in candidates:
        for payload in (candidate, _escape_newlines_in_strings(candidate)):
            try:
                data = json.loads(payload)
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                continue
    return None


def label_fallback(
    payload: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    """Mark a heuristic/offline result clearly for callers and UI."""
    out = dict(payload)
    out["source"] = "heuristic"
    out["reason"] = reason
    return out


def label_ai(payload: dict[str, Any]) -> dict[str, Any]:
    """Mark a successful LLM result."""
    out = dict(payload)
    out["source"] = "ai"
    out.pop("reason", None)
    return out


async def generate_json_with_retries(
    *,
    system: str,
    user: str,
    max_tokens: int = 1500,
    timeout_ms: int | None = None,
    attempts: int = 2,
    repair_hint: str | None = None,
    validate: Callable[[dict[str, Any]], Any] | None = None,
    enable_thinking: bool = False,
) -> tuple[Any | None, str | None]:
    """
    LLM → JSON with immediate retries + optional repair pass.

    Returns (validated_or_parsed, None) on success, or (None, reason) after
    all attempts. Heuristic fallback stays in the calling agent — only after
    this returns a failure reason.

    Default timeout allows slow job completions (>120s). Attempt 2+ uses a
    shorter budget so total time stays under the Fastify HTTP ceiling.

    Thinking stays off. A caller can pass enable_thinking=True when a slow
    reasoning pass is required.
    """
    from app.llm import (
        LLM_JOB_TIMEOUT_MS,
        clamp_llm_timeout_ms,
        generate_ai_text,
        is_ai_configured,
    )

    if not is_ai_configured():
        return None, "llm_not_configured"

    primary_timeout = clamp_llm_timeout_ms(
        timeout_ms if timeout_ms is not None else LLM_JOB_TIMEOUT_MS
    )
    # Keep a short second try without blowing the 240s HTTP max.
    retry_timeout = min(primary_timeout, 60_000)
    repair_timeout = min(primary_timeout, 60_000)

    last_reason = "llm_empty"
    last_raw = ""

    for attempt in range(1, max(1, attempts) + 1):
        call_timeout = primary_timeout if attempt == 1 else retry_timeout
        try:
            raw = await generate_ai_text(
                system=system,
                user=user,
                max_tokens=max_tokens,
                timeout_ms=call_timeout,
                enable_thinking=enable_thinking,
            )
        except Exception as err:  # noqa: BLE001
            last_reason = f"llm_error:{type(err).__name__}"
            logger.warning(
                "generate_json_with_retries attempt %s/%s raised %s",
                attempt,
                attempts,
                err,
            )
            continue

        if not raw:
            last_reason = "llm_empty"
            continue

        last_raw = raw
        parsed = extract_json(raw)
        if not parsed:
            last_reason = "llm_bad_json"
            try:
                fixed = await generate_ai_text(
                    system=(
                        repair_hint
                        or "Convert the following into ONLY valid JSON. No markdown."
                    ),
                    user=raw[:4500],
                    max_tokens=min(max_tokens, 1200),
                    timeout_ms=repair_timeout,
                )
                parsed = extract_json(fixed or "")
            except Exception as err:  # noqa: BLE001
                logger.warning("JSON repair failed: %s", err)
                parsed = None
            if not parsed:
                continue
            last_reason = "llm_repaired_json"

        if validate is not None:
            try:
                normalized = validate(parsed)
            except Exception as err:  # noqa: BLE001
                last_reason = f"llm_invalid:{type(err).__name__}"
                continue
            if normalized is None:
                last_reason = "llm_invalid"
                continue
            return normalized, None

        return parsed, None

    if last_raw and last_reason == "llm_bad_json":
        logger.warning(
            "generate_json_with_retries exhausted; last raw prefix=%r",
            last_raw[:120],
        )
    return None, last_reason
