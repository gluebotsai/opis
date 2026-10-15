"""Page-scoped co-worker assist."""

from __future__ import annotations

import re
from typing import Any, TypedDict

from app.agents.native_pipeline import run_steps

from app.agents.coworker_shared import (
    actions_without_speech,
    build_conversation_prompt,
    last_user_text,
    run_chat_json,
)

SYSTEM = """You are the CRM co-worker embedded on a page. Reply with ONLY valid JSON:
{"assistantText":"short helpful reply","actions":[{"type":"navigate","label":"…","href":"/…"}]}

Rules:
- Talk to the user: acknowledge, then help. Never reply with only "On it." or bare status.
- Keep assistantText to 1–3 warm, natural sentences.
- Prefer clear next steps over jargon. Ask naturally — never form labels like "Email:".
- Create vs update: "add a phone/email/…" means update an existing record; navigate to create only for a clearly NEW record.
- Never invent record IDs. Prefer navigating to list or create routes.
- Do not claim you saved or updated data — the user must confirm in the UI.
- Never coach magic words ("type yes", "say skip").
- Only greet once — never re-greet mid-flow.
- actions is optional; only include safe in-app paths starting with /.
- If unsure, explain what the user can do on this page. Prefer navigate/clarify only.
"""


class PageAssistState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    context: dict[str, Any]
    catalog: dict[str, Any]
    result: dict[str, Any]


def sanitize_actions(raw: Any) -> list[dict[str, str]] | None:
    if not isinstance(raw, list):
        return None
    out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "navigate":
            continue
        label = item.get("label")
        href = item.get("href")
        if not isinstance(label, str) or not isinstance(href, str):
            continue
        href = href.strip()
        if not href.startswith("/") or href.startswith("//"):
            continue
        out.append({"type": "navigate", "label": label.strip()[:80], "href": href})
    return out[:5] or None


def heuristic(text: str, ctx: dict[str, Any]) -> dict[str, Any]:
    lower = text.lower()
    mod = str(ctx.get("module") or "").lower()
    actions: list[dict[str, str]] = []

    if re.search(r"create|add|new", lower):
        if mod == "contact" or "contact" in lower:
            actions.append(
                {"type": "navigate", "label": "New contact", "href": "/contact/new"}
            )
        if mod == "company" or "compan" in lower:
            actions.append(
                {"type": "navigate", "label": "New company", "href": "/company/new"}
            )
        if mod == "sales" or "deal" in lower:
            actions.append(
                {"type": "navigate", "label": "New deal", "href": "/sales/new"}
            )
        if mod == "product" or "product" in lower:
            actions.append(
                {"type": "navigate", "label": "New product", "href": "/product/new"}
            )
        if mod == "finance" or "invoice" in lower:
            actions.append(
                {"type": "navigate", "label": "New invoice", "href": "/finance/new"}
            )
        if mod == "activities" or re.search(r"activit|log a ", lower):
            actions.append(
                {
                    "type": "navigate",
                    "label": "Log activity",
                    "href": "/activities/log",
                }
            )
        if "quote" in lower:
            actions.append(
                {
                    "type": "navigate",
                    "label": "New quote",
                    "href": "/sales/quotes/new",
                }
            )

    if actions:
        return {
            "ok": True,
            "assistantText": (
                "I can take you to the create flow — use a button below. "
                "I won’t save anything until you confirm there."
            ),
            "actions": actions,
        }

    where = ctx.get("pathname") or f"the {mod or 'CRM'} page"
    return {
        "ok": True,
        "assistantText": (
            f"You're on {where} ({ctx.get('surface') or 'page'}). "
            "Ask me to create something, open a related module, or explain what you can do here."
        ),
    }


async def handle(state: PageAssistState) -> PageAssistState:
    messages = state.get("messages") or []
    ctx = state.get("context") or {}
    catalog = state.get("catalog") or {}
    user_text = last_user_text(messages)
    if not user_text:
        return {
            **state,
            "result": {"ok": False, "error": "Send a message to get help on this page."},
        }

    business_type = str(catalog.get("businessType") or "")
    if ctx.get("module") == "finance" and business_type == "b2c":
        return {
            **state,
            "result": {
                "ok": True,
                "source": "heuristic",
                "reason": "rbac_gate",
                "assistantText": (
                    "Finance isn’t available for B2C workspaces. Switch modules or ask about "
                    "contacts and commerce instead."
                ),
            },
        }

    full_catalog = {
        "role": catalog.get("role"),
        "businessType": business_type,
        "context": ctx,
        "hintRoutes": [
            "/contact/new",
            "/company/new",
            "/sales/new",
            "/product/new",
            "/finance/new",
            "/activities/log",
            "/sales/quotes/new",
        ],
    }
    ai = await run_chat_json(
        system=SYSTEM,
        user=build_conversation_prompt(full_catalog, messages),
        max_tokens=500,
    )
    if ai:
        actions = sanitize_actions(ai.get("actions"))
        # also allow actions nested under patch from older parsers
        if not actions and isinstance(ai.get("patch"), dict):
            actions = sanitize_actions(ai["patch"].get("actions"))
        result: dict[str, Any] = {
            "ok": True,
            "assistantText": ai["assistantText"],
            "source": "ai",
        }
        if actions:
            result["actions"] = actions
        return {**state, "result": result}

    from app.agents.coworker_shared import LLM_ERROR_SPEECH
    from app.llm import is_ai_configured

    if not is_ai_configured():
        return {
            **state,
            "result": {"ok": False, "assistantText": LLM_ERROR_SPEECH, "source": "error", "reason": "llm_unavailable"},
        }
    return {
        **state,
        "result": {
            "ok": True,
            "assistantText": "",
            "_unhandled": True,
            "source": "ai",
            "reason": "llm_empty",
        },
    }


_PIPELINE_STEPS = (
    handle,
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    *,
    messages: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    catalog: dict[str, Any] | None = None,
    organization_id: str | None = None,
) -> dict[str, Any]:
    del organization_id
    result = await _run_pipeline(
        {
            "messages": messages or [],
            "context": context or {},
            "catalog": catalog or {},
        }
    )
    return result.get("result") or {"ok": False, "error": "Page assist failed."}
