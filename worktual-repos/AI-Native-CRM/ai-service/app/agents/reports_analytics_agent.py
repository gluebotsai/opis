"""Active facade for the read-only B2B reports and analytics specialist."""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.agents.reports_analytics_adapter import (
    _format_money,
    build_analytics_visual,
)

_DEFAULT_ANALYTICS_SUGGESTIONS = [
    "What's our win rate this month?",
    "Show pipeline by stage",
    "Which rep has the most open deals?",
]


class AnalyticsScope(BaseModel):
    """Trusted tenant and caller scope supplied by the coworker MCP context."""

    model_config = ConfigDict(extra="forbid")
    organization_id: str
    actor_id: str
    role: str
    business_type: str


def _bind_display_currency(organization_id: str) -> None:
    from app.agents.reports_b2b.kg_executor.core.kg_client import (
        resolve_org_default_currency,
    )
    from app.services.display_currency import set_display_currency

    set_display_currency(resolve_org_default_currency(organization_id))


def _analytics_suggestions(visual: dict[str, Any]) -> list[str]:
    title = str(visual.get("title") or "").lower()
    if "win rate" in title:
        return ["Pipeline by stage", "Open deals", "Won revenue this month"]
    if "pipeline" in title:
        return ["What's my win rate?", "Open deals", "Won revenue this month"]
    if title.startswith("leads"):
        return ["Deals created this week", "Open deals", "Win rate"]
    if "open deal" in title:
        return ["Pipeline by stage", "Win rate", "Won revenue this month"]
    if "closed won by rep" in title or "by rep" in title:
        return ["Won revenue this month", "Win rate", "Pipeline by stage"]
    return list(_DEFAULT_ANALYTICS_SUGGESTIONS)


async def run(
    *,
    question: str,
    organization_id: str,
    actor_id: str,
    role: str,
    business_type: str,
    session_id: str | None = None,
    messages: list[dict[str, Any]] | None = None,
    working_memory: dict[str, Any] | None = None,
    time_phrase: str | None = None,
    object_lock: str | None = None,
) -> dict[str, Any]:
    """Run the single reports domain path and preserve the coworker UI contract."""
    try:
        from app.agents.reports_analytics_adapter import build_structured_analytics
        from app.agents.reports_analytics_turn import run_turn

        _bind_display_currency(organization_id)
        scope = AnalyticsScope(
            organization_id=organization_id,
            actor_id=actor_id,
            role=role,
            business_type=business_type,
        )
        turn = await run_turn(
            question=question,
            scope=scope,
            session_id=session_id,
            messages=messages,
            working_memory=working_memory,
            time_phrase=time_phrase,
            object_lock=object_lock,
        )
    except Exception as exc:  # noqa: BLE001
        logging.getLogger(__name__).exception("reports B2B turn failed: %s", exc)
        return {
            "ok": False,
            "assistantText": (
                "I couldn't load that from CRM analytics right now. "
                "Try asking about pipeline, leads, deals, or revenue for a specific period."
            ),
            "source": "ai",
            "reason": "reports_turn_failed",
            "error": "reports_turn_failed",
            "suggestions": list(_DEFAULT_ANALYTICS_SUGGESTIONS),
            "analytics": None,
            "reportsContextPatch": None,
        }

    assistant_text = str(turn.get("assistantText") or "").strip()
    rows = turn.get("rows") if isinstance(turn.get("rows"), list) else []
    plan = (
        turn.get("plan")
        if isinstance(turn.get("plan"), dict)
        else {"kind": "plan", "tasks": []}
    )
    tasks = plan.get("tasks") if isinstance(plan.get("tasks"), list) else []
    if not tasks:
        return {
            "ok": True,
            "assistantText": assistant_text,
            "source": "ai",
            "suggestions": list(_DEFAULT_ANALYTICS_SUGGESTIONS),
            "analytics": None,
            "reportsContextPatch": turn.get("reportsContextPatch"),
        }
    kpi_slices = (
        turn.get("kpi_slices")
        if isinstance(turn.get("kpi_slices"), list)
        else []
    )
    breakdowns = (
        turn.get("breakdowns")
        if isinstance(turn.get("breakdowns"), list)
        else []
    )
    from app.agents.reports_analytics_companion import companion_assistant_text

    card_choice = (
        turn.get("card_choice")
        if isinstance(turn.get("card_choice"), dict)
        else {"kind": "none"}
    )
    analytics = build_structured_analytics(
        plan=plan,
        rows=rows,
        assistant_text=assistant_text,
        organization_id=organization_id,
        business_type=business_type,
        had_kg=bool(turn.get("had_kg")),
        progress=(
            turn.get("progress")
            if isinstance(turn.get("progress"), list)
            else None
        ),
        kpi_slices=kpi_slices,
        breakdowns=breakdowns,
        card_choice=card_choice,
    )
    speech = companion_assistant_text(assistant_text, analytics)
    if isinstance(analytics.get("findings"), dict):
        analytics = {
            **analytics,
            "findings": {**analytics["findings"], "summary": speech},
        }
    return {
        "ok": True,
        "assistantText": speech,
        "source": "ai",
        "suggestions": _analytics_suggestions(analytics.get("visual") or {}),
        "analytics": analytics,
        "reportsContextPatch": turn.get("reportsContextPatch"),
    }


__all__ = [
    "AnalyticsScope",
    "_format_money",
    "build_analytics_visual",
    "run",
]
