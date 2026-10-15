"""Quote detail co-worker — rewrite document sections in chat."""

from __future__ import annotations

import re
from typing import Any, TypedDict

from app.agents.document_section_shared import (
    QUOTE_SECTION_ALIASES,
    detect_document_section_key,
    wants_document_section_rewrite,
)
from app.agents.draft_conversation import (
    propose_send_quote_proposal,
    wants_send_quote,
)
from app.agents.native_pipeline import run_steps


class QuoteCoworkerState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    context: dict[str, Any]
    catalog: dict[str, Any]
    organization_id: str
    result: dict[str, Any]


def _last_user(messages: list[dict[str, Any]] | None) -> str:
    for m in reversed(messages or []):
        if isinstance(m, dict) and m.get("role") == "user":
            return str(m.get("text") or "").strip()
    return ""


def _quote_id(ctx: dict[str, Any]) -> str:
    eid = str(ctx.get("entityId") or "").strip()
    if eid:
        return eid
    path = str(ctx.get("pathname") or "")
    m = re.search(r"/sales/quotes/([^/?#]+)", path)
    return m.group(1).strip() if m else ""


def _extract_instruction(text: str, section_key: str | None) -> str:
    t = text.strip()
    t = re.sub(
        r"^(please\s+)?(rewrite|re-write|rework|revise|improve|enhance|regenerate|refresh|update|change|edit)\s+"
        r"(the\s+)?(section\s+)?",
        "",
        t,
        flags=re.I,
    )
    if section_key:
        for key, aliases in QUOTE_SECTION_ALIASES:
            if key != section_key:
                continue
            for alias in sorted(aliases, key=len, reverse=True):
                t = re.sub(rf"^(the\s+)?{re.escape(alias)}\b[:\s,-]*", "", t, flags=re.I)
    t = re.sub(r"^(content|body|text|to\s+say|to|with|as)\s*[:\-]?\s*", "", t, flags=re.I)
    return t.strip()


def propose_rewrite_quote_section(
    *,
    quote_id: str,
    section_key: str,
    instruction: str = "",
    tool_id: str = "rewrite-quote-section",
) -> dict[str, Any]:
    label = f"Rewrite {section_key.replace('_', ' ')}"
    return {
        "id": tool_id,
        "name": "propose_rewrite_quote_section",
        "label": label[:80],
        "args": {
            "quoteId": quote_id,
            "sectionKey": section_key,
            "auto": True,
            **({"instruction": instruction[:2000]} if instruction else {}),
        },
        "risk": "low",
    }


def _heuristic_quote_result(
    *,
    text: str,
    quote_id: str,
) -> dict[str, Any] | None:
    lower = text.lower()
    if wants_send_quote(text):
        return {
            "ok": True,
            "assistantText": "Sending this quote now.",
            "toolProposals": [propose_send_quote_proposal(quote_id=quote_id)],
        }

    section_key = detect_document_section_key(text, aliases=QUOTE_SECTION_ALIASES)
    if section_key and wants_document_section_rewrite(lower):
        instruction = _extract_instruction(text, section_key)
        return {
            "ok": True,
            "assistantText": f"Rewriting the {section_key.replace('_', ' ')} section.",
            "toolProposals": [
                propose_rewrite_quote_section(
                    quote_id=quote_id,
                    section_key=section_key,
                    instruction=instruction,
                )
            ],
            "uiRefresh": {
                "modules": ["quotes"],
                "entityIds": [quote_id],
                "reason": "quote_rewrite",
            },
        }
    return None


async def handle(state: QuoteCoworkerState) -> QuoteCoworkerState:
    messages = state.get("messages") or []
    ctx = state.get("context") or {}
    catalog = state.get("catalog") or {}
    text = _last_user(messages)
    quote_id = _quote_id(ctx)

    if not quote_id:
        return {**state, "result": {"ok": True, "_unhandled": True}}

    hit = _heuristic_quote_result(text=text, quote_id=quote_id)
    if hit:
        return {**state, "result": {**hit, "source": "heuristic"}}

    from app.agents.coworker_shared import should_commit_native_turn
    from app.agents.crm_tools import run_native_agent_turn
    from app.llm import is_ai_configured

    if not is_ai_configured():
        from app.agents.coworker_shared import LLM_ERROR_SPEECH

        return {
            **state,
            "result": {
                "ok": False,
                "assistantText": LLM_ERROR_SPEECH,
                "source": "error",
                "reason": "llm_unavailable",
            },
        }

    native = await run_native_agent_turn(
        mod="quotes",
        surface=str(ctx.get("surface") or "detail"),
        messages=messages,
        context=ctx,
        catalog=catalog,
        user_text=text,
    )
    if should_commit_native_turn(native, user_text=text):
        return {**state, "result": {**native, "source": "ai"}}

    hit = _heuristic_quote_result(text=text, quote_id=quote_id)
    if hit:
        return {
            **state,
            "result": {**hit, "source": "heuristic", "reason": "llm_fallback"},
        }

    return {**state, "result": {"ok": True, "assistantText": "", "_unhandled": True}}


_PIPELINE_STEPS = (handle,)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    messages: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    catalog: dict[str, Any] | None = None,
    organization_id: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "messages": messages or [],
            "context": context or {},
            "catalog": catalog or {},
            "organization_id": organization_id or "",
        }
    )
    out = result.get("result")
    return out if isinstance(out, dict) else {"ok": True, "_unhandled": True}
