"""JSON payloads for the sample SQL-agent tester UI."""

from __future__ import annotations

from typing import Any

from sql_agent.cli import html_to_text
from sql_agent.compile import default_period, last_calendar_month
from sql_agent.context import QueryContext
from sql_agent.orchestrator import OrchestratorTurn
from sql_agent.settings import get_minimax_settings
from sql_agent.status import AGENTS
from sql_agent.tools import SqlAgentTools
from sql_agent.warehouse import get_warehouse_settings, live_enabled

PERIOD_7D = "7d"
PERIOD_LAST_MONTH = "last_month"
MAX_QUESTION_CHARS = 2000


def period_window(kind: str | None) -> tuple[str, str]:
    if (kind or "").strip() == PERIOD_LAST_MONTH:
        return last_calendar_month()
    return default_period()


def resolve_period(
    *,
    kind: str | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
) -> tuple[str, str]:
    start = (period_start or "").strip()
    end = (period_end or "").strip()
    if start and end:
        return start, end
    return period_window(kind)


def setup_payload() -> dict[str, Any]:
    settings = get_minimax_settings()
    warehouse = get_warehouse_settings()
    week_start, week_end = default_period()
    month_start, month_end = last_calendar_month()
    return {
        "model": settings.model,
        "host": settings.host,
        "organization_id": warehouse.organization_id,
        "live": live_enabled(),
        "warehouse": "postgres" if warehouse.url else "unavailable",
        "agents": [
            {"name": name, "role": meta["role"], "summary": meta["summary"]}
            for name, meta in AGENTS.items()
        ],
        "periods": {
            PERIOD_7D: {
                "id": PERIOD_7D,
                "label": "Last 7 days",
                "start": week_start,
                "end": week_end,
            },
            PERIOD_LAST_MONTH: {
                "id": PERIOD_LAST_MONTH,
                "label": "Last month",
                "start": month_start,
                "end": month_end,
            },
        },
        "samples": [
            {"question": "average handel time", "period": "7d"},
            {"question": "how many conversations were handled", "period": "7d"},
            {"question": "waht is yesterday chat count", "period": "7d"},
            {"question": "which agents handled more chats channel wise", "period": "last_month"},
            {"question": "channel mix last month", "period": "last_month"},
            {"question": "daily handled trend last month", "period": "last_month"},
            {"question": "disposition mix by queue last month", "period": "last_month"},
            {"question": "average handle time by channel last month", "period": "last_month"},
        ],
    }


def turn_payload(
    question: str,
    ctx: QueryContext,
    turn: OrchestratorTurn,
    tools: SqlAgentTools,
) -> dict[str, Any]:
    specialist = turn.specialist
    warehouse = tools.last_result or {}
    plan = tools.last_plan or {}
    return {
        "question": question,
        "reply_html": turn.reply,
        "reply_text": html_to_text(turn.reply),
        "model": turn.model,
        "host": turn.host,
        "routed_to": turn.routed_to,
        "supervisor_rounds": turn.supervisor_rounds,
        "elapsed_ms": turn.elapsed_ms,
        "context": {
            "organization_id": ctx.organization_id,
            "period_start": ctx.period_start,
            "period_end": ctx.period_end,
            "period_label": ctx.period_label,
            "surface": ctx.surface,
        },
        "events": [event.as_dict() for event in turn.events],
        "plan": {
            "trust": plan.get("trust"),
            "reason": plan.get("reason"),
            "sql": plan.get("sql"),
            "metric": plan.get("metric"),
            "period_start": plan.get("period_start"),
            "period_end": plan.get("period_end"),
            "organization_id": plan.get("organization_id"),
            "headline": plan.get("headline"),
            "preview": (plan.get("preview") or [])[:12],
            "numbers_locked": plan.get("numbers_locked"),
            "iterations": plan.get("iterations") or [],
        },
        "warehouse": {
            "ok": warehouse.get("ok"),
            "dry_run": warehouse.get("dry_run"),
            "warehouse": warehouse.get("warehouse"),
            "headline": warehouse.get("headline"),
            "preview": warehouse.get("preview") or [],
            "total_matched_rows": warehouse.get("total_matched_rows"),
            "truncated": warehouse.get("truncated"),
            "error": warehouse.get("error"),
            "period_start": warehouse.get("period_start"),
            "period_end": warehouse.get("period_end"),
            "organization_id": warehouse.get("organization_id"),
        },
        "tool_trace": (specialist.tool_trace if specialist else []) or [],
        "specialist_rounds": specialist.rounds if specialist else 0,
        "specialist_elapsed_ms": specialist.elapsed_ms if specialist else 0,
    }
