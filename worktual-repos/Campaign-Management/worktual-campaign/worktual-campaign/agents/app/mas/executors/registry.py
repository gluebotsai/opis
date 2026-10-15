"""Executor runner registry."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

Runner = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]

_RUNNERS: dict[str, Runner] = {}


def _ensure_wired() -> None:
    """Load the complete Executor catalog lazily to avoid import cycles."""
    wiring = {
        "contact": ("app.mas.executors.contact.runner", "run_contact_executor"),
        "audience_selection": (
            "app.mas.executors.audience_selection.runner",
            "run_audience_selection_executor",
        ),
        "audience_pull": (
            "app.mas.executors.audience_pull.runner",
            "run_audience_pull_executor",
        ),
        "monitoring": ("app.mas.executors.monitoring.runner", "run_monitoring_executor"),
        "analytics": ("app.mas.executors.analytics.runner", "run_analytics_executor"),
        "recovery": ("app.mas.executors.recovery.runner", "run_recovery_executor"),
        "brief_validation": (
            "app.mas.executors.brief_validation.runner",
            "run_brief_validation_executor",
        ),
        "campaign_audience": (
            "app.mas.executors.campaign_audience.runner",
            "run_campaign_audience_executor",
        ),
        "campaign_content": (
            "app.mas.executors.campaign_content.runner",
            "run_campaign_content_executor",
        ),
        "recommendation": (
            "app.mas.executors.recommendation.runner",
            "run_recommendation_executor",
        ),
        "launch_scheduling": (
            "app.mas.executors.launch_scheduling.runner",
            "run_launch_scheduling_executor",
        ),
        "whatsapp_approved_send": (
            "app.mas.executors.whatsapp_approved_send.runner",
            "run_whatsapp_approved_send_executor",
        ),
        "content_verification": (
            "app.mas.executors.content_verification.runner",
            "run_content_verification_executor",
        ),
        "template_coach": (
            "app.mas.executors.template_coach.runner",
            "run_template_coach_executor",
        ),
        "email_content": (
            "app.mas.executors.email_content.runner",
            "run_email_content_executor",
        ),
        "whatsapp_content": (
            "app.mas.executors.whatsapp_content.runner",
            "run_whatsapp_content_executor",
        ),
        "app_push_content": (
            "app.mas.executors.app_push_content.runner",
            "run_app_push_content_executor",
        ),
        "web_push_content": (
            "app.mas.executors.web_push_content.runner",
            "run_web_push_content_executor",
        ),
        "image_generation": (
            "app.mas.executors.image_generation.runner",
            "run_image_generation_executor",
        ),
        "image_generate": (
            "app.mas.executors.image_generate.runner",
            "run_image_generate_executor",
        ),
        "image_refine": (
            "app.mas.executors.image_refine.runner",
            "run_image_refine_executor",
        ),
        "image_attach": (
            "app.mas.executors.image_attach.runner",
            "run_image_attach_executor",
        ),
        "campaign_images": (
            "app.mas.executors.campaign_images.runner",
            "run_campaign_images_executor",
        ),
        "email_html_compose": (
            "app.mas.executors.email_html_compose.runner",
            "run_email_html_compose_executor",
        ),
        "search_knowledge": (
            "app.mas.executors.search_knowledge.runner",
            "run_search_knowledge_executor",
        ),
        "form_theme": ("app.mas.executors.form_theme.runner", "run_form_theme_executor"),
        "form_fields": (
            "app.mas.executors.form_fields.runner",
            "run_form_fields_executor",
        ),
        "form_design": (
            "app.mas.executors.form_design.runner",
            "run_form_design_executor",
        ),
    }
    import importlib

    for eid, (mod_name, attr) in wiring.items():
        if eid in _RUNNERS:
            continue
        mod = importlib.import_module(mod_name)
        _RUNNERS[eid] = getattr(mod, attr)


def get_executor_runner(executor_id: str) -> Runner:
    _ensure_wired()
    eid = str(executor_id or "").strip().lower()
    if eid not in _RUNNERS:

        async def missing(ctx: dict[str, Any]) -> dict[str, Any]:
            return {
                "ok": False,
                "error": f"Unknown or unwired executor {eid}",
                "action_status": "failed",
            }

        return missing
    return _RUNNERS[eid]
