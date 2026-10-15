"""Skill catalog — Super Agent knowledge of sub-agents (no chat modules)."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

SkillHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]

# Intent → ordered skill ids (sequential only; no parallel).
INTENT_PIPELINES: dict[str, list[str]] = {
    "on_demand_send": ["on_demand"],
    "on_demand": ["on_demand"],
    "create_and_launch": ["on_demand"],
    "create_contact": ["contacts"],
    "contacts_create": ["contacts"],
    "campaign_report": ["monitoring"],
    "monitoring_report": ["monitoring"],
    "analyze_campaign": ["monitoring"],
    "stop_channel": ["monitoring"],
    "resume_channel": ["monitoring"],
    "stop_campaign": ["monitoring"],
    # Multi-task: create contact then send on-demand
    "create_contact_and_send": ["contacts", "on_demand"],
    "contact_then_send": ["contacts", "on_demand"],
    "send_approved_whatsapp": ["whatsapp_send"],
    "generate_image": ["image_gen"],
    "temp_audience_and_send": ["temp_audience_send"],
}

SKILL_DEFS: list[dict[str, Any]] = [
    {
        "id": "on_demand",
        "name": "On-Demand Agent",
        "description": (
            "Create a campaign from a hub request, generate templates, and launch "
            "automatically. No human confirmation loop."
        ),
        "inputs_required": ["token"],
        "inputs_optional": [
            "request_text",
            "emails",
            "phones",
            "contact_ids",
            "customer_ids",
            "channels",
            "name",
            "goal",
            "objective",
            "source",
        ],
        "outputs": ["campaign_id", "templates", "analysis", "launch"],
        "autonomous": True,
        "no_clarification": True,
    },
    {
        "id": "contacts",
        "name": "Contacts Agent",
        "description": (
            "Create a contact from hub-provided fields (first_name + email or phone). "
            "Hub confirmation is implied by the task; no chat questions."
        ),
        "inputs_required": ["token", "first_name"],
        "inputs_optional": [
            "last_name",
            "email",
            "phone",
            "company_name",
            "city",
        ],
        "outputs": ["contact_id", "contact"],
        "autonomous": True,
        "no_clarification": True,
    },
    {
        "id": "monitoring",
        "name": "Monitoring Agent",
        "description": (
            "Campaign analysis and monitoring actions: report, stop channel, "
            "resume channel, stop campaign. Requires campaign_id from hub."
        ),
        "inputs_required": ["token", "campaign_id"],
        "inputs_optional": ["action", "channel", "reason"],
        "outputs": ["report", "action_result"],
        "autonomous": True,
        "no_clarification": True,
    },
    {
        "id": "whatsapp_send",
        "name": "WhatsApp Approved Send",
        "description": (
            "Send a Meta-approved WhatsApp template to hub-provided phones "
            "or contact_ids via the content domain executor."
        ),
        "inputs_required": ["token"],
        "inputs_optional": [
            "request_text",
            "template_id",
            "template_name",
            "phones",
            "contact_ids",
            "user_confirmed",
        ],
        "outputs": ["send_result", "message"],
        "autonomous": True,
        "no_clarification": True,
    },
    {
        "id": "image_gen",
        "name": "Image Generate",
        "description": (
            "Generate a single campaign image from a prompt (image domain)."
        ),
        "inputs_required": ["token", "prompt"],
        "inputs_optional": ["request_text", "campaign_id", "attach_to_template"],
        "outputs": ["image_url", "message"],
        "autonomous": True,
        "no_clarification": True,
    },
    {
        "id": "temp_audience_send",
        "name": "Temp audience on-demand send",
        "description": (
            "Normalize inline contact rows to audience fields, then run "
            "on-demand create+launch."
        ),
        "inputs_required": ["token", "rows"],
        "inputs_optional": [
            "request_text",
            "channels",
            "name",
            "goal",
            "objective",
        ],
        "outputs": ["campaign_id", "templates", "launch"],
        "autonomous": True,
        "no_clarification": True,
    },
]


def skill_ids() -> list[str]:
    return [str(s["id"]) for s in SKILL_DEFS]


def get_skill(skill_id: str) -> dict[str, Any] | None:
    sid = str(skill_id or "").strip().lower()
    for row in SKILL_DEFS:
        if row["id"] == sid:
            return dict(row)
    return None


def pipeline_for_intent(intent: str) -> list[str] | None:
    key = str(intent or "").strip().lower().replace("-", "_")
    steps = INTENT_PIPELINES.get(key)
    return list(steps) if steps else None


def agent_card() -> dict[str, Any]:
    """Discovery document for hub A2A."""
    return {
        "name": "worktual-campaign-super-agent",
        "version": "1.0",
        "no_clarification": True,
        "execution": "sequential",
        "intents": sorted(INTENT_PIPELINES.keys()),
        "skills": SKILL_DEFS,
        "endpoints": {
            "tasks": "/ai/v1/hub/tasks",
            "agent_card": "/.well-known/agent.json",
        },
    }
