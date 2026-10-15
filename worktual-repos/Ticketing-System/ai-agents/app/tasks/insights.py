"""Executive ticket insights — LLM via coworker-agents (not Node Gemini)."""

from __future__ import annotations

import json
import re
from typing import Any

from app.messages_compat import HumanMessage, SystemMessage

from app.llm import get_llm
from app.llm_log import log_llm


def _extract_json_array(text: str) -> list[str] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(x).strip() for x in parsed if str(x).strip()]
    except json.JSONDecodeError:
        pass
    m = re.search(r"\[[\s\S]*\]", raw)
    if not m:
        return None
    try:
        parsed = json.loads(m.group(0))
        if isinstance(parsed, list):
            return [str(x).strip() for x in parsed if str(x).strip()]
    except json.JSONDecodeError:
        return None
    return None


def ticket_insights(tickets: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Return { insights: list[str], source: str }.
    tickets: [{ticket_number, subject, priority, status, customer_name, channel}, ...]
    """
    if not tickets:
        return {
            "insights": [
                "**No tickets in scope** — nothing to analyze for this role/org filter.",
                "**Tip**: Create a ticket or widen your queue to see AI insights.",
            ],
            "source": "coworker-agents (empty)",
        }

    lines = []
    for t in tickets[:50]:
        lines.append(
            f'- ID: {t.get("ticket_number")}, Subject: "{t.get("subject")}", '
            f'Priority: {t.get("priority")}, Status: {t.get("status")}, '
            f'Customer: {t.get("customer_name")}, Channel: {t.get("channel")}'
        )
    summary = "\n".join(lines)

    system = (
        "You are a Support Operations Consultant for Worktual ticketing.\n"
        "Return ONLY a raw JSON array of 3 or 4 short insight strings. No markdown fences."
    )
    user = (
        f"Analyze these support tickets and provide 3-4 high-value executive insights:\n"
        f"{summary}"
    )

    try:
        llm = get_llm()
        msg = llm.invoke(
            [
                SystemMessage(content=system),
                HumanMessage(content=user),
            ]
        )
        content = getattr(msg, "content", None) or str(msg)
        insights = _extract_json_array(str(content))
        log_llm(
            kind="insights",
            user_text=f"tickets={len(tickets)}",
            response=(str(content) or "")[:800],
            agent="insights",
        )
        if insights:
            return {
                "insights": insights[:4],
                "source": "coworker-agents LLM",
            }
    except Exception as exc:  # noqa: BLE001
        log_llm(
            kind="insights_error",
            user_text=f"tickets={len(tickets)}",
            response="",
            agent="insights",
            error=str(exc),
        )

    return {
        "insights": _fallback_insights(tickets),
        "source": "coworker-agents fallback",
    }


def _fallback_insights(tickets: list[dict]) -> list[str]:
    """Derive tips from the provided ticket rows — no static product copy."""
    n = len(tickets)
    by_status: dict[str, int] = {}
    by_priority: dict[str, int] = {}
    for t in tickets:
        st = str(t.get("status") or "Unknown")
        pr = str(t.get("priority") or "unknown")
        by_status[st] = by_status.get(st, 0) + 1
        by_priority[pr] = by_priority.get(pr, 0) + 1
    status_bits = ", ".join(f"{k}={v}" for k, v in sorted(by_status.items())) or "none"
    prio_bits = ", ".join(f"{k}={v}" for k, v in sorted(by_priority.items())) or "none"
    return [
        f"**Ticket load**: {n} ticket(s) in the current analytics scope.",
        f"**By status**: {status_bits}.",
        f"**By priority**: {prio_bits}.",
    ]
