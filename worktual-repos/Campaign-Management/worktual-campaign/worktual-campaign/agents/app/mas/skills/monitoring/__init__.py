"""Register Optimization / monitoring module skills."""

from __future__ import annotations

from pathlib import Path

from app.mas.skills.registry import SkillRegistry
from app.mas.skills.types import SkillSpec

_PACKAGE = Path(__file__).resolve().parent

MONITORING_MODULE = "monitoring"

_LIST_COMPLETE = frozenset({"LIST_MONITOR_CAMPAIGNS"})
_REPORT_COMPLETE = frozenset({"GET_CAMPAIGN_REPORT", "GET_CAMPAIGN_AUDIENCE"})
_RECOVERY_COMPLETE = frozenset({"STOP_CAMPAIGN", "STOP_CHANNEL", "RESUME_CHANNEL"})
_AB_COMPLETE = frozenset({"PICK_AB_WINNER"})

# Hub / cron task names → (executor_id, skill_id). Deterministic bindings only.
HUB_SKILL_TO_CHAT: dict[str, tuple[str, str]] = {
    "campaign_list": ("monitoring", "monitor_list"),
    "list_campaigns": ("monitoring", "monitor_list"),
    "list_monitor_campaigns": ("monitoring", "monitor_list"),
    "campaign_report": ("monitoring", "monitor_report"),
    "monitoring_report": ("monitoring", "monitor_report"),
    "analyze_campaign": ("monitoring", "monitor_report"),
    "monitoring": ("monitoring", "monitor_report"),
    "stop_campaign": ("recovery", "monitor_recovery"),
    "stop_channel": ("recovery", "monitor_recovery"),
    "resume_channel": ("recovery", "monitor_recovery"),
    "pick_ab_winner": ("recovery", "monitor_ab"),
    "ab_test_winner": ("recovery", "monitor_ab"),
}


def map_hub_skill(hub_skill: str) -> tuple[str, str] | None:
    key = str(hub_skill or "").strip().lower().replace("-", "_")
    return HUB_SKILL_TO_CHAT.get(key)


def register_monitoring_skills(registry: SkillRegistry) -> None:
    registry.register(
        SkillSpec(
            module=MONITORING_MODULE,
            skill_id="monitor_list",
            executor_id="monitoring",
            tool_names=frozenset({"LIST_MONITOR_CAMPAIGNS", "ROUTE_TO_MODULE"}),
            completion_tool_names=_LIST_COMPLETE,
            description="List live / scheduled / past / draft campaigns in a monitoring bucket.",
            prompt_path=_PACKAGE / "monitor_list.md",
        )
    )
    registry.register(
        SkillSpec(
            module=MONITORING_MODULE,
            skill_id="monitor_report",
            executor_id="monitoring",
            tool_names=frozenset(
                {
                    "GET_CAMPAIGN_REPORT",
                    "GET_CAMPAIGN_AUDIENCE",
                    "ROUTE_TO_MODULE",
                }
            ),
            completion_tool_names=_REPORT_COMPLETE,
            description="One-campaign performance report and audience sent/missed details.",
            prompt_path=_PACKAGE / "monitor_report.md",
        )
    )
    registry.register(
        SkillSpec(
            module=MONITORING_MODULE,
            skill_id="monitor_recovery",
            executor_id="recovery",
            tool_names=frozenset(
                {
                    "STOP_CAMPAIGN",
                    "STOP_CHANNEL",
                    "RESUME_CHANNEL",
                    "ROUTE_TO_MODULE",
                }
            ),
            completion_tool_names=_RECOVERY_COMPLETE,
            description="Stop a campaign or pause/resume one channel (requires user reason to stop).",
            prompt_path=_PACKAGE / "monitor_recovery.md",
        )
    )
    registry.register(
        SkillSpec(
            module=MONITORING_MODULE,
            skill_id="monitor_ab",
            executor_id="recovery",
            tool_names=frozenset({"PICK_AB_WINNER", "ROUTE_TO_MODULE"}),
            completion_tool_names=_AB_COMPLETE,
            description="Pick email A/B winner and send holdout remainder.",
            prompt_path=_PACKAGE / "monitor_ab.md",
        )
    )


__all__ = [
    "HUB_SKILL_TO_CHAT",
    "MONITORING_MODULE",
    "map_hub_skill",
    "register_monitoring_skills",
]
