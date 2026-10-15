"""Template-canvas specialist: mutates fields from an edit-space job (not user chat)."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.template_edit.definition import load_canvas_specialist
from app.agents.template_edit.snapshot import compact_live_snapshot
from app.agents.template_edit.tools.handlers import dispatch_edit_tool, serialize_tool_result
from app.agents.template_edit.tools.schemas import schemas_for_names
from app.agents.template_library.shared import get_llm
from app.llm import CHAT_LLM_TIMEOUT_S, CHAT_MAX_TOKENS, CHAT_REASONING_EFFORT
from app.runtime.agent import run_tool_loop
from app.text_cleanup import strip_html_tags, strip_markdown_emphasis

_log = logging.getLogger(__name__)

_RECEIPT_NUDGE = (
    "Write one short receipt of what the tools did. "
    "Do not claim a change unless a tool returned ok."
)


def _plain(text: str) -> str:
    return strip_markdown_emphasis(strip_html_tags(str(text or "").strip()))


async def run_template_canvas_agent(
    *,
    ctx: dict[str, Any],
    explanation: str,
    image_urls: list[str] | None = None,
    placement: str = "",
) -> dict[str, Any]:
    """LLM + mutation tools. Job comes from the edit-space agent, not user text."""
    channel = str(ctx.get("channel") or "email")
    specialist = load_canvas_specialist(channel)
    prior_allowed = set(ctx.get("allowed") or [])
    ctx["allowed"] = set(specialist.tool_names)
    working = ctx.get("working") if isinstance(ctx.get("working"), dict) else {}
    snap = compact_live_snapshot(channel=specialist.channel, fields=working)
    urls = [str(u).strip() for u in (image_urls or []) if str(u).strip()]
    job = {
        "explanation": str(explanation or "").strip(),
        "image_urls": urls[:12],
        "placement": str(placement or "").strip() or "hero",
    }
    system = specialist.system_prompt(
        "Live template snapshot:\n"
        + json.dumps(snap, ensure_ascii=False)
        + "\nJob from edit-space agent:\n"
        + json.dumps(job, ensure_ascii=False)
    )
    user = (
        f"Explanation:\n{job['explanation'] or '(see image_urls)'}\n"
        f"Placement: {job['placement']}\n"
        f"Image URLs: {json.dumps(urls, ensure_ascii=False)}"
        + (
            "\nListed image URLs are already placed. Do remaining copy/layout only."
            if urls
            else ""
        )
    )

    async def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        try:
            result = await dispatch_edit_tool(name, args, ctx=ctx)
        except Exception as exc:  # noqa: BLE001
            _log.warning("canvas tool %s failed: %s", name, exc)
            return {"ok": False, "error": "That canvas step failed."}
        note = str(result.get("note") or result.get("error") or "")
        if note and isinstance(ctx.get("working_row"), dict):
            ctx["working_row"]["last_tool_note"] = note[:400]
        return result

    for url in urls[:12]:
        placed = await dispatch(
            "attach_uploaded_image",
            {"image_url": url, "placement": job["placement"]},
        )
        if not placed.get("ok"):
            ctx["allowed"] = prior_allowed
            err = str(placed.get("error") or "Could not place a listed image.")
            return {
                "ok": False,
                "changed": False,
                "note": err,
                "receipt": err,
                "image_url": "",
                "error": err,
            }

    loop = await run_tool_loop(
        llm=get_llm(),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        tools=schemas_for_names(specialist.tool_names),
        dispatch=dispatch,
        max_rounds=6,
        timeout_s=min(75.0, CHAT_LLM_TIMEOUT_S),
        timeout_retries=1,
        max_tokens=CHAT_MAX_TOKENS,
        reasoning_effort=CHAT_REASONING_EFFORT,
        require_content_after_tools=True,
        post_tools_nudge=_RECEIPT_NUDGE,
        empty_content_retries=1,
        disable_thinking=True,
        serialize_tool_result=serialize_tool_result,
        unavailable_reply="",
    )
    ctx["allowed"] = prior_allowed
    state = ctx.get("state") if isinstance(ctx.get("state"), dict) else {}
    ok = bool(state.get("persist_fields"))
    receipt = _plain(loop.content) or str(state.get("last_note") or "")
    return {
        "ok": ok,
        "changed": ok,
        "note": receipt or ("Updated the live template." if ok else "No canvas change."),
        "receipt": receipt,
        "image_url": str(state.get("image_url") or ""),
    }
