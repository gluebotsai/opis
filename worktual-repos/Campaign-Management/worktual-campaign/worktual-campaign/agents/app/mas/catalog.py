"""MAS domain and executor catalog (skills deferred)."""

from __future__ import annotations

from typing import Any

DOMAIN_IDS: tuple[str, ...] = (
    "audience",
    "creation",
    "recommendation_run",
    "library_run",
    "whatsapp_approved_run",
    "content",
    "image",
    "optimization",
    "forms",
)

# Legacy Socket module → MAS domain (for sticky / flag checks).
MODULE_TO_DOMAIN: dict[str, str] = {
    "contacts": "audience",
    "create_campaign": "creation",
    "recommendation_run": "recommendation_run",
    "library_run": "library_run",
    "recommendations": "creation",
    "on_demand": "creation",
    "monitoring": "optimization",
    "reports": "optimization",
    "events_report": "optimization",
    "forms": "forms",
    "template_library": "content",
    "template_coach": "content",
    "whatsapp_approved": "whatsapp_approved_run",
    "whatsapp_rejected": "content",
    "image": "image",
}

DOMAIN_EXECUTORS: dict[str, tuple[str, ...]] = {
    "audience": ("contact", "audience_selection", "audience_pull"),
    "creation": (
        "brief_validation",
        "campaign_audience",
        "campaign_content",
        "email_html_compose",
        "search_knowledge",
        "recommendation",
        "launch_scheduling",
    ),
    "recommendation_run": (
        "brief_validation",
        "campaign_audience",
        "campaign_content",
        "launch_scheduling",
    ),
    "library_run": (
        "brief_validation",
        "campaign_audience",
        "campaign_content",
        "launch_scheduling",
    ),
    "whatsapp_approved_run": (
        "brief_validation",
        "campaign_audience",
        "launch_scheduling",
    ),
    "content": (
        "whatsapp_content",
        "email_content",
        "app_push_content",
        "web_push_content",
        "content_verification",
        "template_coach",
        "whatsapp_approved_send",
    ),
    "optimization": ("monitoring", "analytics", "recovery"),
    "forms": ("form_theme", "form_fields", "form_design"),
    "image": ("image_generate", "image_refine", "image_attach", "campaign_images"),
}

EXECUTOR_META: dict[str, dict[str, Any]] = {
    "contact": {
        "domain": "audience",
        "name": "Contact Executor",
        "description": "Create, update, view, and company-pack contact operations.",
    },
    "audience_selection": {
        "domain": "audience",
        "name": "Audience Selection Executor",
        "description": "Segments, filters, assignment, temporary uploads.",
    },
    "audience_pull": {
        "domain": "audience",
        "name": "Audience Pull / SQL Executor",
        "description": "Materialize and freeze audience lists.",
    },
    "brief_validation": {
        "domain": "creation",
        "name": "Campaign Brief Validation Executor",
        "description": "Validate and persist campaign overview fields.",
    },
    "campaign_audience": {
        "domain": "creation",
        "name": "Campaign Audience Executor",
        "description": "Named recipients, create/update contacts, temp sheet for this campaign.",
    },
    "campaign_content": {
        "domain": "creation",
        "name": "Campaign Content Executor",
        "description": "Generate and persist channel templates via build_campaign.",
    },
    "email_html_compose": {
        "domain": "creation",
        "name": "Email HTML Compose Executor",
        "description": "Email-only Phase 2 compose: idea in, compiled_html template card out.",
    },
    "search_knowledge": {
        "domain": "creation",
        "name": "Campaign Knowledge Search Executor",
        "description": "Search tenant campaign KB via context_layer (product/business/support).",
    },
    "recommendation": {
        "domain": "creation",
        "name": "Campaign Recommendation Executor",
        "description": "Past campaigns and recommendation board.",
    },
    "launch_scheduling": {
        "domain": "creation",
        "name": "Launch and Scheduling Executor",
        "description": "Schedule, launch, dynamic offer, on-demand send.",
    },
    "whatsapp_content": {
        "domain": "content",
        "name": "WhatsApp Content Executor",
        "description": "Generate WhatsApp templates.",
    },
    "email_content": {
        "domain": "content",
        "name": "Email Content Executor",
        "description": "Generate email templates.",
    },
    "app_push_content": {
        "domain": "content",
        "name": "App Push Content Executor",
        "description": "Generate app push templates.",
    },
    "web_push_content": {
        "domain": "content",
        "name": "Web Push Content Executor",
        "description": "Generate web push templates.",
    },
    "image_generate": {
        "domain": "image",
        "name": "Image Generate Executor",
        "description": (
            "Ask what to generate, enhance the brief, confirm, then call Gemini."
        ),
    },
    "image_refine": {
        "domain": "image",
        "name": "Image Refine Executor",
        "description": "Enhance edit brief then refine existing image.",
    },
    "image_attach": {
        "domain": "image",
        "name": "Image Attach Executor",
        "description": "Attach generated image URL to template fields.",
    },
    "campaign_images": {
        "domain": "image",
        "name": "Campaign Images Executor",
        "description": (
            "Plan, batch-generate, and attach campaign images across channels "
            "(shared or per-channel)."
        ),
    },
    "content_verification": {
        "domain": "content",
        "name": "Content Verification Executor",
        "description": "Verify content; WhatsApp rejected fix/resubmit; compliance.",
    },
    "template_coach": {
        "domain": "content",
        "name": "Template Coach Executor",
        "description": "Manual-edit AI assist.",
    },
    "whatsapp_approved_send": {
        "domain": "content",
        "name": "WhatsApp Approved Send Executor",
        "description": "Send already Meta-approved templates.",
    },
    "monitoring": {
        "domain": "optimization",
        "name": "Campaign Monitoring Executor",
        "description": "Lists, reports, audience outcomes.",
    },
    "analytics": {
        "domain": "optimization",
        "name": "Campaign Analytics Executor",
        "description": "KPI analytics, ontology, events report.",
    },
    "recovery": {
        "domain": "optimization",
        "name": "Channel Delivery Recovery Executor",
        "description": "Stop/pause/resume, A/B winner, delivery recovery.",
    },
    "form_theme": {
        "domain": "forms",
        "name": "Form Theme Executor",
        "description": "Form theme specialist.",
    },
    "form_fields": {
        "domain": "forms",
        "name": "Form Fields Executor",
        "description": "Form fields specialist.",
    },
    "form_design": {
        "domain": "forms",
        "name": "Form Design Executor",
        "description": "Full form design specialist.",
    },
}


# Deprecated executor ids → canonical catalog id (registry may still expose alias runners).
EXECUTOR_ALIASES: dict[str, str] = {
    "image_generation": "image_generate",
}


def normalize_domain(domain_id: str | None) -> str | None:
    raw = str(domain_id or "").strip().lower().replace("-", "_")
    if not raw:
        return None
    if raw in DOMAIN_IDS:
        return raw
    return MODULE_TO_DOMAIN.get(raw)


def normalize_executor(executor_id: str | None) -> str | None:
    raw = str(executor_id or "").strip().lower().replace("-", "_")
    if raw in EXECUTOR_META:
        return raw
    return EXECUTOR_ALIASES.get(raw)


def domain_for_executor(executor_id: str | None) -> str | None:
    eid = normalize_executor(executor_id)
    if not eid:
        return None
    return str(EXECUTOR_META[eid]["domain"])


def executors_for_domain(domain_id: str | None) -> tuple[str, ...]:
    did = normalize_domain(domain_id)
    if not did:
        return ()
    return DOMAIN_EXECUTORS.get(did, ())
