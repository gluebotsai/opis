"""Register Optimization / reports (dashboard) module skills."""

from __future__ import annotations

from pathlib import Path

from app.mas.skills.registry import SkillRegistry
from app.mas.skills.types import SkillSpec

_PACKAGE = Path(__file__).resolve().parent

REPORTS_MODULE = "reports"

_KPI_COMPLETE = frozenset({"query_analytics", "ask_semantic_layer"})
_LIVE_OPS_COMPLETE = frozenset(
    {"GET_CAMPAIGN_LIVE_STATUS", "GET_RECENT_SEND_FAILURES"}
)
_ONTOLOGY_COMPLETE = frozenset({"ask_ontology"})
_CAMPAIGN_COMPLETE = frozenset(
    {"LIST_MONITOR_CAMPAIGNS", "GET_CAMPAIGN_REPORT", "GET_CAMPAIGN_AUDIENCE"}
)
_EVENTS_COMPLETE = frozenset({"LIST_EVENTS", "GET_EVENT_DETAIL"})

# Hub / deterministic surface → (executor_id, skill_id)
SURFACE_TO_SKILL: dict[str, tuple[str, str]] = {
    "reports": ("analytics", "report_kpis"),
    "dashboard": ("analytics", "report_kpis"),
    "events_report": ("analytics", "events_report"),
}


def map_reports_surface(surface_or_module: str) -> tuple[str, str] | None:
    key = str(surface_or_module or "").strip().lower().replace("-", "_")
    return SURFACE_TO_SKILL.get(key)


def register_reports_skills(registry: SkillRegistry) -> None:
    registry.register(
        SkillSpec(
            module=REPORTS_MODULE,
            skill_id="dashboard-live-ops",
            executor_id="analytics",
            tool_names=frozenset(
                {
                    "GET_CAMPAIGN_LIVE_STATUS",
                    "GET_RECENT_SEND_FAILURES",
                    "GET_OPS_FEED",
                    "LIST_MONITOR_CAMPAIGNS",
                    "ROUTE_TO_MODULE",
                }
            ),
            completion_tool_names=_LIVE_OPS_COMPLETE,
            description="Live send batches, pending/sent, and recent failure reasons.",
            prompt_path=_PACKAGE / "dashboard_live_ops.md",
            extra={
                "triggers": [
                    "what is sending now",
                    "live send",
                    "queued batch",
                    "send failure",
                    "pending recipients",
                ],
                "workflow": [
                    "GET active live sends or campaign live status",
                    "GET recent failures when user asks why sends failed",
                ],
                "rules": [
                    "Never guess pipeline state — call live ops tools",
                    "Include as_of from tool results",
                ],
            },
        )
    )
    registry.register(
        SkillSpec(
            module=REPORTS_MODULE,
            skill_id="report_kpis",
            executor_id="analytics",
            tool_names=frozenset(
                {
                    "GET_PORTFOLIO_PERFORMANCE",
                    "query_analytics",
                    "ask_semantic_layer",
                    "GET_ACTIVITY_SERIES",
                    "ROUTE_TO_MODULE",
                }
            ),
            completion_tool_names=frozenset(
                {"GET_PORTFOLIO_PERFORMANCE", "query_analytics", "ask_semantic_layer"}
            ),
            description="Dashboard KPI / metrics questions (rates, volumes, period totals).",
            prompt_path=_PACKAGE / "report_kpis.md",
            extra={
                "triggers": [
                    "open rate",
                    "click rate",
                    "how many sent",
                    "campaigns ran",
                    "portfolio",
                ],
                "workflow": [
                    "query_analytics with explicit metrics[] and period",
                    "GET_ACTIVITY_SERIES for daily send/open trend",
                ],
                "rules": [
                    "Always pass metrics[] — never infer from NL in tools",
                ],
            },
        )
    )
    registry.register(
        SkillSpec(
            module=REPORTS_MODULE,
            skill_id="report_ontology",
            executor_id="analytics",
            tool_names=frozenset({"ask_ontology", "ROUTE_TO_MODULE"}),
            completion_tool_names=_ONTOLOGY_COMPLETE,
            description="Ontology / past-campaign graph questions (themes, relationships).",
            prompt_path=_PACKAGE / "report_ontology.md",
        )
    )
    registry.register(
        SkillSpec(
            module=REPORTS_MODULE,
            skill_id="report_campaigns",
            executor_id="analytics",
            tool_names=frozenset(
                {
                    "LIST_MONITOR_CAMPAIGNS",
                    "GET_CAMPAIGN_REPORT",
                    "GET_CAMPAIGN_AUDIENCE",
                    "ROUTE_TO_MODULE",
                }
            ),
            completion_tool_names=_CAMPAIGN_COMPLETE,
            description="Named campaign lists and one-campaign detail from dashboard chat.",
            prompt_path=_PACKAGE / "report_campaigns.md",
        )
    )
    registry.register(
        SkillSpec(
            module=REPORTS_MODULE,
            skill_id="events_report",
            executor_id="analytics",
            tool_names=frozenset({"LIST_EVENTS", "GET_EVENT_DETAIL", "ROUTE_TO_MODULE"}),
            completion_tool_names=_EVENTS_COMPLETE,
            description="Events report: list events and load event detail.",
            prompt_path=_PACKAGE / "events_report.md",
        )
    )


__all__ = [
    "REPORTS_MODULE",
    "SURFACE_TO_SKILL",
    "map_reports_surface",
    "register_reports_skills",
]
