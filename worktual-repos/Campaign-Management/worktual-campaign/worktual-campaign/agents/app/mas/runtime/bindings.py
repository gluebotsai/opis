"""Hub / cron bindings — Hub hints for Super/Domain; cron skips Super."""

from __future__ import annotations

from typing import Any

# Hub skill id / intent → MAS target hints (Super → Domain → Executor).
HUB_BINDINGS: dict[str, dict[str, str]] = {
    "create_contact": {
        "domain_id": "audience",
        "executor_id": "contact",
    },
    "contacts_create": {
        "domain_id": "audience",
        "executor_id": "contact",
    },
    "create-contact": {
        "domain_id": "audience",
        "executor_id": "contact",
    },
    "on_demand_send": {
        "domain_id": "creation",
        "executor_id": "launch_scheduling",
    },
    "on_demand": {
        "domain_id": "creation",
        "executor_id": "launch_scheduling",
    },
    "create_and_launch": {
        "domain_id": "creation",
        "executor_id": "launch_scheduling",
    },
    "on-demand-send": {
        "domain_id": "creation",
        "executor_id": "launch_scheduling",
    },
    "campaign_report": {
        "domain_id": "optimization",
        "executor_id": "monitoring",
    },
    "monitoring_report": {
        "domain_id": "optimization",
        "executor_id": "monitoring",
    },
    "analyze_campaign": {
        "domain_id": "optimization",
        "executor_id": "monitoring",
    },
    "campaign-report": {
        "domain_id": "optimization",
        "executor_id": "monitoring",
    },
    "stop_channel": {
        "domain_id": "optimization",
        "executor_id": "recovery",
    },
    "resume_channel": {
        "domain_id": "optimization",
        "executor_id": "recovery",
    },
    "stop_campaign": {
        "domain_id": "optimization",
        "executor_id": "recovery",
    },
    "stop-channel": {
        "domain_id": "optimization",
        "executor_id": "recovery",
    },
    "resume-channel": {
        "domain_id": "optimization",
        "executor_id": "recovery",
    },
    "stop-campaign": {
        "domain_id": "optimization",
        "executor_id": "recovery",
    },
    "send_approved_whatsapp": {
        "domain_id": "content",
        "executor_id": "whatsapp_approved_send",
    },
    "send-approved-whatsapp": {
        "domain_id": "content",
        "executor_id": "whatsapp_approved_send",
    },
    "generate_image": {
        "domain_id": "image",
        "executor_id": "image_generate",
    },
    "generate-image": {
        "domain_id": "image",
        "executor_id": "image_generate",
    },
    "temp_audience_and_send": {
        "domain_id": "creation",
        "executor_id": "launch_scheduling",
    },
    "temp-audience-and-send": {
        "domain_id": "creation",
        "executor_id": "launch_scheduling",
    },
}

# Cron / worker event → MAS target (deterministic; no Super).
CRON_BINDINGS: dict[str, dict[str, str]] = {
    "email_ab_auto_winner": {
        "domain_id": "optimization",
        "executor_id": "recovery",
    },
    "email_health_auto_pause": {
        "domain_id": "optimization",
        "executor_id": "recovery",
    },
    "whatsapp_status_tick": {
        "domain_id": "optimization",
        "executor_id": "recovery",
    },
    "send_time_optimizer": {
        "domain_id": "creation",
        "executor_id": "launch_scheduling",
    },
    "template_compliance_scan": {
        "domain_id": "content",
        "executor_id": "content_verification",
    },
    "meta_approval_status": {
        "domain_id": "content",
        "executor_id": "content_verification",
    },
}


def resolve_hub_binding(skill_or_intent: str | None) -> dict[str, Any] | None:
    key = str(skill_or_intent or "").strip().lower().replace("-", "_")
    alt = str(skill_or_intent or "").strip().lower()
    row = HUB_BINDINGS.get(key) or HUB_BINDINGS.get(alt)
    return dict(row) if row else None


def resolve_cron_binding(event_id: str | None) -> dict[str, Any] | None:
    key = str(event_id or "").strip().lower().replace("-", "_")
    row = CRON_BINDINGS.get(key)
    return dict(row) if row else None
