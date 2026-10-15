"""Proactive missed-callback planning API."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field

from app.api.auth import authenticate_internal
from app.llm.client import LLMClient, get_llm_client
from app.prompts.proactive import PROACTIVE_CALLBACK_PROMPT


class EligibleAgentPayload(BaseModel):
    setup_user_id: str
    agent_id: str
    display_name: str
    skills: list[str] = Field(default_factory=list)
    open_callback_count: int = 0
    skill_score: int = 0


class ProactivePlanRequest(BaseModel):
    organization_id: str
    missed_contact_id: str
    conversation_id: str | None = None
    contact_id: str | None = None
    queue_id: str | None = None
    channel: str
    reason: str
    missed_at: str
    customer_name: str | None = None
    queue_name: str | None = None
    queue_description: str | None = None
    queue_skills: list[str] = Field(default_factory=list)
    eligible_agents: list[EligibleAgentPayload] = Field(default_factory=list)
    queue_close_time: str | None = None


def _parse_clock(value: str | None) -> tuple[int, int]:
    if not value:
        return 18, 0
    parts = value.strip().split(":")
    if len(parts) < 2:
        return 18, 0
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return 18, 0


def _resolve_due_at(preset: str, close_time: str | None) -> datetime:
    now = datetime.now(timezone.utc).astimezone()
    if preset == "1h":
        return now + timedelta(hours=1)
    if preset == "4h":
        return now + timedelta(hours=4)
    hours, minutes = _parse_clock(close_time)
    due = now.replace(hour=hours, minute=minutes, second=0, microsecond=0)
    if due <= now:
        due = due + timedelta(days=1)
    return due


def _deterministic_plan(payload: ProactivePlanRequest) -> dict[str, Any]:
    if not payload.eligible_agents:
        return {"skip": True, "reason": "No eligible agents available"}

    channel = (payload.channel or "").strip().lower()
    if channel in {"webchat", "chat", "voice"}:
        return {
            "skip": True,
            "reason": "Missed channel is not callback-eligible without a reachable outreach identity",
        }
    if channel not in {"whatsapp", "instagram", "facebook", "email"}:
        return {"skip": True, "reason": f"Unsupported callback channel: {payload.channel}"}

    picked = sorted(
        payload.eligible_agents,
        key=lambda agent: (-agent.skill_score, agent.open_callback_count, agent.agent_id),
    )[0]
    due_at = _resolve_due_at("4h", payload.queue_close_time)
    return {
        "assigned_user_id": picked.setup_user_id,
        "due_at": due_at.isoformat(),
        "priority": "normal",
        "channel": channel,
        "title": f"Callback · {channel.capitalize()}",
        "summary": f"Co-worker assigned callback after missed contact in {payload.queue_name or 'queue'}.",
        "notes": (
            f"Picked {picked.display_name}: skill score {picked.skill_score}, "
            f"{picked.open_callback_count} open callbacks."
        ),
        "confidence": "medium",
    }


def create_proactive_router(api_v1_base: str) -> APIRouter:
    router = APIRouter(prefix=f"{api_v1_base}/proactive", tags=["Proactive"])

    @router.post("/missed-callback/plan")
    async def plan_missed_callback(
        request: ProactivePlanRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> dict[str, Any]:
        authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "proactive",
        )

        if not request.eligible_agents:
            return {"skip": True, "reason": "No eligible agents available"}

        user_payload = {
            "customer_name": request.customer_name,
            "queue_name": request.queue_name,
            "queue_description": request.queue_description,
            "queue_skills": request.queue_skills,
            "channel": request.channel,
            "reason": request.reason,
            "eligible_agents": [agent.model_dump() for agent in request.eligible_agents],
        }

        try:
            result = await llm.json(
                [
                    {
                        "role": "system",
                        "content": (
                            PROACTIVE_CALLBACK_PROMPT
                            + "\nReturn JSON with either:"
                            + " {skip:true,reason} OR"
                            + " {assigned_user_id,due_preset,channel,title,summary,notes,confidence}."
                        ),
                    },
                    {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
                ]
            )
        except Exception:
            return _deterministic_plan(request)

        if result.get("skip") is True:
            return {"skip": True, "reason": str(result.get("reason") or "Skipped by co-worker")}

        assigned_user_id = str(result.get("assigned_user_id") or "").strip()
        valid_ids = {agent.setup_user_id for agent in request.eligible_agents}
        if assigned_user_id not in valid_ids:
            return _deterministic_plan(request)

        due_preset = str(result.get("due_preset") or "4h")
        if due_preset not in {"1h", "4h", "eod"}:
            due_preset = "4h"
        channel = str(result.get("channel") or request.channel).strip().lower()
        if channel in {"webchat", "chat", "voice"}:
            return {
                "skip": True,
                "reason": "Missed channel is not callback-eligible without a reachable outreach identity",
            }
        if channel not in {"whatsapp", "instagram", "facebook", "email"}:
            return _deterministic_plan(request)

        due_at = _resolve_due_at(due_preset, request.queue_close_time)
        picked = next(
            (agent for agent in request.eligible_agents if agent.setup_user_id == assigned_user_id),
            request.eligible_agents[0],
        )

        return {
            "assigned_user_id": assigned_user_id,
            "due_at": due_at.isoformat(),
            "priority": str(result.get("priority") or "normal"),
            "channel": channel,
            "title": str(
                result.get("title")
                or f"Callback · {channel.capitalize()}"
            ),
            "summary": str(
                result.get("summary")
                or f"Co-worker assigned callback after missed contact in {request.queue_name or 'queue'}."
            ),
            "notes": str(
                result.get("notes")
                or f"Picked {picked.display_name} for proactive callback recovery."
            ),
            "confidence": str(result.get("confidence") or "high"),
        }

    return router
