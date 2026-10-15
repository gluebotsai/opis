"""Executive summary generation for scheduled CCaaS reports."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ExecutiveSummaryRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    period_label: str = Field(alias="periodLabel", min_length=1, max_length=255)
    schedule_label: str = Field(alias="scheduleLabel", min_length=1, max_length=64)
    org_kpis: dict[str, Any] = Field(alias="orgKpis")
    team_rollup: dict[str, Any] | None = Field(default=None, alias="teamRollup")
    top_performers: list[dict[str, Any]] | None = Field(default=None, alias="topPerformers")
    needs_attention: list[dict[str, Any]] | None = Field(default=None, alias="needsAttention")
    channel_mix_top3: list[dict[str, Any]] | None = Field(default=None, alias="channelMixTop3")
    disposition_mix_top3: list[dict[str, Any]] | None = Field(default=None, alias="dispositionMixTop3")
    included_sections: list[str] = Field(default_factory=list, alias="includedSections")
    agent_rows: list[dict[str, Any]] | None = Field(default=None, alias="agentRows")

    @field_validator("org_kpis")
    @classmethod
    def validate_org_kpis(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not value:
            raise ValueError("org_kpis is required")
        return value

    @field_validator("agent_rows")
    @classmethod
    def reject_bulk_agent_rows(cls, value: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
        if value and len(value) > 5:
            raise ValueError("agent_rows exceeds allowed size")
        return value


class ExecutiveSummaryResponse(BaseModel):
    summary: str
    highlights: list[str] = Field(default_factory=list, max_length=3)
    improvement_suggestions: list[str] = Field(
        default_factory=list,
        max_length=5,
        alias="improvementSuggestions",
    )


class AgentPerformanceSummaryRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    period_label: str = Field(alias="periodLabel", min_length=1, max_length=255)
    schedule_label: str = Field(alias="scheduleLabel", min_length=1, max_length=64)
    agent_name: str = Field(alias="agentName", min_length=1, max_length=255)
    agent_kpis: dict[str, Any] = Field(alias="agentKpis")
    channel_mix_top3: list[dict[str, Any]] | None = Field(default=None, alias="channelMixTop3")
    disposition_mix_top3: list[dict[str, Any]] | None = Field(
        default=None,
        alias="dispositionMixTop3",
    )
    included_sections: list[str] = Field(default_factory=list, alias="includedSections")

    @field_validator("agent_kpis")
    @classmethod
    def validate_agent_kpis(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not value:
            raise ValueError("agent_kpis is required")
        return value


def build_agent_performance_summary_prompt(
    payload: AgentPerformanceSummaryRequest,
) -> list[dict[str, str]]:
    grounded = {
        "periodLabel": payload.period_label,
        "scheduleLabel": payload.schedule_label,
        "agentName": payload.agent_name,
        "agentKpis": payload.agent_kpis,
        "channelMixTop3": payload.channel_mix_top3,
        "dispositionMixTop3": payload.disposition_mix_top3,
        "includedSections": payload.included_sections,
    }
    return [
        {
            "role": "system",
            "content": (
                "You write concise personal performance summaries for one contact-center agent. "
                "Use ONLY numbers present in the user JSON. Do not invent metrics or compare to other agents. "
                "Return JSON with keys summary (2-4 sentences), highlights (max 3 short bullets), "
                "and improvementSuggestions (max 5 actionable coaching bullets for this agent only)."
            ),
        },
        {"role": "user", "content": json.dumps(grounded, ensure_ascii=False)},
    ]


def build_executive_summary_prompt(payload: ExecutiveSummaryRequest) -> list[dict[str, str]]:
    grounded = {
        "periodLabel": payload.period_label,
        "scheduleLabel": payload.schedule_label,
        "orgKpis": payload.org_kpis,
        "teamRollup": payload.team_rollup,
        "topPerformers": payload.top_performers,
        "needsAttention": payload.needs_attention,
        "channelMixTop3": payload.channel_mix_top3,
        "dispositionMixTop3": payload.disposition_mix_top3,
        "includedSections": payload.included_sections,
    }
    return [
        {
            "role": "system",
            "content": (
                "You write concise executive summaries for contact-center performance reports. "
                "Use ONLY numbers present in the user JSON. Do not invent metrics. "
                "Return JSON with keys summary (2-4 sentences), highlights (max 3 short bullets), "
                "and improvementSuggestions (max 5 actionable coaching bullets for agents/team)."
            ),
        },
        {"role": "user", "content": json.dumps(grounded, ensure_ascii=False)},
    ]
