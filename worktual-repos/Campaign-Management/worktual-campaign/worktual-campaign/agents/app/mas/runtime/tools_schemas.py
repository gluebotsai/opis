"""Shared OpenAI tool schemas for MAS handoffs."""

from __future__ import annotations

ROUTE_TO_DOMAIN_TOOL = {
    "type": "function",
    "function": {
        "name": "route_to_domain",
        "description": (
            "Route the user request to exactly one Domain Agent. "
            "Call this when you know which domain owns the work. "
            "Do not collect campaign fields or call CRM/campaign APIs."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "domain_id": {
                    "type": "string",
                    "enum": [
                        "audience",
                        "creation",
                        "content",
                        "image",
                        "optimization",
                        "forms",
                    ],
                    "description": (
                        "audience=contacts/segments; creation=campaign design/"
                        "launch/recommendations; content=templates/WA/coach; "
                        "image=generate/refine/attach campaign images; "
                        "optimization=monitoring/reports/pause-resume; "
                        "forms=event form theme/fields/design."
                    ),
                },
                "restated_query": {
                    "type": "string",
                    "description": "Short restatement of what the user wants.",
                },
                "change_summary": {
                    "type": "string",
                    "description": "One-line reason for this routing choice.",
                },
            },
            "required": ["domain_id", "restated_query"],
        },
    },
}

INVOKE_EXECUTOR_TOOL = {
    "type": "function",
    "function": {
        "name": "invoke_executor",
        "description": (
            "Hand the planned task to one Executor Agent under this domain. "
            "Pass structured task_spec fields the executor needs."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "executor_id": {
                    "type": "string",
                    "description": "Executor id from this domain's allowlist.",
                },
                "restated_query": {
                    "type": "string",
                    "description": "What the executor should do.",
                },
                "user_confirmed": {
                    "type": "boolean",
                    "description": "True only when the user clearly confirmed a mutate action.",
                },
                "change_summary": {"type": "string"},
            },
            "required": ["executor_id", "restated_query"],
        },
    },
}

REQUEST_DOMAIN_HANDOFF_TOOL = {
    "type": "function",
    "function": {
        "name": "request_domain_handoff",
        "description": (
            "Ask Super to continue this turn in another Domain. "
            "Use when work clearly belongs outside this domain "
            "(e.g. Creation needs Content for templates, or Audience for CRM contacts). "
            "Do not invent success; do not call peer domains yourself."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "domain_id": {
                    "type": "string",
                    "enum": [
                        "audience",
                        "creation",
                        "content",
                        "image",
                        "optimization",
                        "forms",
                    ],
                },
                "restated_query": {
                    "type": "string",
                    "description": "What the target domain should do.",
                },
                "preferred_executor": {
                    "type": "string",
                    "description": (
                        "Optional executor id under the target domain "
                        "(e.g. email_content, contact)."
                    ),
                },
                "change_summary": {"type": "string"},
            },
            "required": ["domain_id", "restated_query"],
        },
    },
}

SUPER_TOOLS = [ROUTE_TO_DOMAIN_TOOL]

# Domain executor catalogs for LLM enum constraints + prompt hints.
DOMAIN_EXECUTOR_HINTS: dict[str, str] = {
    "audience": (
        "- contact: create/update/view/search one contact, company pack\n"
        "- audience_selection: segments, filters, bulk/temp upload, assignment\n"
        "- audience_pull: materialize/freeze audience lists / SQL pull\n"
        "Default to contact for normal CRM contact chat."
    ),
    "optimization": (
        "- monitoring: live/scheduled campaign lists, reports, audience outcomes\n"
        "- analytics: KPI analytics, ontology, semantic layer, events report\n"
        "- recovery: stop/pause/resume channel or campaign, A/B winner\n"
        "Default to monitoring for ops status questions."
    ),
    "creation": (
        "- brief_validation: campaign name/goal/channels/audience_text setup\n"
        "- campaign_audience: named emails/phones, create/update contacts, temp sheet\n"
        "- campaign_content: generate/persist templates (build_campaign; email uses Phase 2)\n"
        "- email_html_compose: email-only HTML from idea (Phase 2); prefer when only email "
        "needs generate this turn\n"
        "- recommendation: recommendations board from past campaigns\n"
        "- launch_scheduling: schedule/launch/on-demand send\n"
        "Default to brief_validation for general create-campaign setup.\n"
        "Prefer campaign_content when the user wants templates generated now "
        "(including multi-channel or with hero/banner images — use build_campaign + "
        "plan_campaign_images there).\n"
        "Prefer email_html_compose for email-only create/regenerate from a clear idea.\n"
        "- search_knowledge: look up product/business facts in the org knowledge base "
        "(offers, pricing, features). Use when the user asks, or when copy must stay grounded.\n"
        "Prefer campaign_audience when the user names people or uploads a temp sheet.\n"
        "Use request_domain_handoff → image ONLY after templates exist, or for standalone image edits.\n"
        "Use request_domain_handoff → content/audience only when work clearly "
        "belongs in those domains (e.g. template coach, CRM search outside this campaign)."
    ),
    "recommendation_run": (
        "- brief_validation: edit prefilled plan — name/goal/channels/audience_text\n"
        "- campaign_audience: named emails/phones, create/update contacts, temp sheet\n"
        "- campaign_content: generate/persist templates (build_campaign)\n"
        "- launch_scheduling: schedule/launch after explicit confirm\n"
        "Panel is prefilled from the selected recommendation — do not cold-start meta.\n"
        "Default to brief_validation for plan edits; campaign_content only with generate intent.\n"
        "Prefer launch_scheduling when templates_ready and user asks to launch/send/schedule."
    ),
    "library_run": (
        "- brief_validation: align intent + channel scope with library baseline (library_brief)\n"
        "- campaign_audience: named emails/phones, create/update contacts, temp sheet\n"
        "- campaign_content: adopt/adapt/fill baseline creatives (library_templates)\n"
        "- launch_scheduling: schedule/launch after explicit confirm\n"
        "Creative baseline is from Template Library — do not cold-start as empty creatives.\n"
        "Always use library_* skill_ids. Mutate creatives only with clear intent this turn.\n"
        "Prefer launch_scheduling when templates_ready and user asks to launch/send/schedule."
    ),
    "whatsapp_approved_run": (
        "- brief_validation: campaign name, goal, objective\n"
        "- campaign_audience: same as create campaign — check_contacts, create_contact, temp sheet\n"
        "- launch_scheduling: same as create campaign — launch_campaign now or scheduled\n"
        "Template is already Meta-approved and fixed. Do not generate copy or submit Meta approval.\n"
        "Skills: campaign_brief, campaign_audience, campaign_launch only.\n"
        "If the user names people or a phone before audience is matched, use campaign_audience "
        "even if they also said launch.\n"
        "Launch now sends immediately. A future time is stored and a 30-minute check starts sending "
        "when that time has arrived or already passed."
    ),
    "content": (
        "- email_content / whatsapp_content / app_push_content / web_push_content: "
        "generate channel templates\n"
        "- content_verification: verify copy / WhatsApp rejected fix\n"
        "- template_coach: manual edit assist\n"
        "- whatsapp_approved_send: send already-approved WA template\n"
        "Default to email_content when generating unspecified channel copy."
    ),
    "forms": (
        "- form_theme: colors/style only\n"
        "- form_fields: field structure/copy\n"
        "- form_design: full redesign\n"
        "Default to form_theme for small style asks; form_design for major overhauls."
    ),
    "image": (
        "- image_generate: new single image (ask what they need → enhance brief → "
        "confirm → generate)\n"
        "- image_refine: edit last image (enhance → refine)\n"
        "- image_attach: attach last URL to one template field/section\n"
        "- campaign_images: plan + batch generate/attach across channels "
        "(shared or per_channel; email + whatsapp only)\n"
        "Default to campaign_images when user wants images on multiple channels or "
        "shared hero across templates; image_generate for one-off assets."
    ),
}
