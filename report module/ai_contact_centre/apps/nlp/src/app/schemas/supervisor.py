"""Supervisor coaching insight schemas."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AgentAttentionInsightRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent_name: str = Field(alias="agentName", min_length=1, max_length=120)
    team_name: str | None = Field(default=None, alias="teamName", max_length=120)
    queue_names: list[str] = Field(default_factory=list, alias="queueNames", max_length=8)
    classification: str = Field(min_length=1, max_length=64)
    classification_label: str = Field(alias="classificationLabel", min_length=1, max_length=120)
    classification_reasons: list[str] = Field(default_factory=list, alias="classificationReasons", max_length=6)
    not_ready_minutes: int = Field(alias="notReadyMinutes", ge=0, le=24 * 60)
    active_conversations: int = Field(alias="activeConversations", ge=0, le=50)
    attendance_today: str = Field(alias="attendanceToday", max_length=16)
    today_kpis: dict[str, Any] = Field(alias="todayKpis")
    presence_today_seconds: dict[str, Any] = Field(default_factory=dict, alias="presenceTodaySeconds")
    escalations_last7_days: int = Field(alias="escalationsLast7Days", ge=0, le=100)
    queue_waiting_total: int = Field(alias="queueWaitingTotal", ge=0, le=500)
    escalated_at: str = Field(alias="escalatedAt", min_length=10, max_length=40)


class AgentAttentionInsightResponse(BaseModel):
    summary: str = Field(min_length=1, max_length=500)
    suggestion: str = Field(min_length=1, max_length=500)


def build_agent_attention_insight_prompt(
    payload: AgentAttentionInsightRequest,
) -> list[dict[str, str]]:
    grounded = {
        "agentName": payload.agent_name,
        "teamName": payload.team_name,
        "queueNames": payload.queue_names,
        "classification": payload.classification,
        "classificationLabel": payload.classification_label,
        "classificationReasons": payload.classification_reasons,
        "notReadyMinutes": payload.not_ready_minutes,
        "activeConversations": payload.active_conversations,
        "attendanceToday": payload.attendance_today,
        "todayKpis": payload.today_kpis,
        "presenceTodaySeconds": payload.presence_today_seconds,
        "escalationsLast7Days": payload.escalations_last7_days,
        "queueWaitingTotal": payload.queue_waiting_total,
        "escalatedAt": payload.escalated_at,
    }
    return [
        {
            "role": "system",
            "content": (
                "You are a contact-center workforce supervisor assistant. "
                "Given a JSON context packet about one agent who stayed Not Ready and triggered a supervisor alert, "
                "write a concise coaching brief for the admin who will intervene. "
                "Rules:\n"
                "- Use ONLY facts present in the JSON. Never invent metrics, causes, or customer details.\n"
                "- Respect the provided classification and reasons; do not contradict them.\n"
                "- summary: exactly 2 short sentences (max ~45 words total) explaining what is happening and why it matters.\n"
                "- suggestion: one concrete next step the supervisor should take now (max ~30 words).\n"
                "- Tone: calm, direct, supportive—no blame, no HR/legal language.\n"
                "- If queue pressure is mentioned, prioritize service-level risk; if repeat escalation, note the pattern.\n"
                "Return JSON with keys summary and suggestion only."
            ),
        },
        {"role": "user", "content": json.dumps(grounded, ensure_ascii=False)},
    ]
