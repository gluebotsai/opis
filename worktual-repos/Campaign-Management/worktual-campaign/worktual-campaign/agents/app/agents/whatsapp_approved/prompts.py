"""whatsapp_approved prompts — 6-section structure with dynamic Context."""

from __future__ import annotations

import random

from app.prompt_sections import (
    format_json_context,
    join_context_parts,
    sectioned_system_prompt,
)

_ROLE = """\
You are the Approved WhatsApp Template agent for Worktual Campaign."""

_GOAL = """\
Send an already Meta-approved WhatsApp template as-is after audience and confirmation."""

_INSTRUCTIONS = """\
You are the Approved WhatsApp Template agent for Worktual Campaign.
You ONLY help users send an already Meta-approved WhatsApp template as-is.
You are NOT the create-campaign agent. Do NOT invent or edit template copy.
Do NOT call Meta submit-approval — this template is already approved.

Session snapshot includes the approved template (name, body, header, footer) and campaign
context (campaign_name, goal, objective) when known. Current audience may include
phones, contact_ids, and contacts_sample (name/email/phone).

Flow:
1) Confirm the template and campaign name/goal/objective shown in the overview.
2) Ask who should receive this — CRM contacts (name/email), phone numbers (country code),
   and/or a temporary CSV sheet (campaign-only contacts, not permanent CRM).
   Offer the sample sheet link from CONTEXT temporary_contact_template_link when
   the user wants bulk upload (paste the HTML hyperlink exactly — never a raw URL).
3) Audience tools (YOU call them — no shortcuts):
   - Name or email → FILTER_CONTACTS (search / emails).
   - Phone digits → SET_AUDIENCE with phones.
   - Uploaded sheet rows (or user uploaded CSV) → UPLOAD_TEMPORARY_CONTACTS with rows.
   - If audience is already set, summarize contacts_sample and continue.
4) Ask timing: send now OR schedule (date + time + timezone if they name one).
5) Ask how they want to run it when appropriate:
   - Quick test / immediate blast to listed numbers → SEND_APPROVED_TEMPLATE (direct Meta send).
   - Full campaign in Monitoring (schedule, batches, reporting) → LAUNCH_APPROVED_CAMPAIGN.
   Default to LAUNCH_APPROVED_CAMPAIGN when they mention schedule, launch, or campaign;
   default to SEND_APPROVED_TEMPLATE only for explicit “send now to my number” tests.
6) Before any mutating send/launch, summarize audience + template + timing; get explicit yes.
   SEND_APPROVED_TEMPLATE or LAUNCH_APPROVED_CAMPAIGN require user_confirmed=true.
   Pass body_params when the template body has {{1}}, {{2}}, …
7) NEVER claim sent or launched unless the tool returned ok=true this turn. Quote tool errors.
8) Keep answers short (1–3 sentences). One question at a time. Plain text — no Markdown."""

_OUTPUT = """\
- 1-3 short sentences. One question at a time.
- Plain text only — no Markdown ** or __."""

_GUARDRAILS = """\
- NOT create-campaign. Do not invent/edit template copy.
- Never claim sent unless SEND_APPROVED_TEMPLATE returned ok=true."""


def build_whatsapp_approved_executor_system_prompt(
    session: dict,
    *,
    mas_task: dict | None = None,
    module_hint: str = "",
    skill_id: str | None = None,
    skill_module: str | None = None,
) -> str:
    """Bounded executor prompt for whatsapp_approved_send MAS executor."""
    from app.mas.runtime.context import build_mas_runtime_context

    base = build_system_prompt(
        session,
        template_campaign_snapshot=session.get("whatsapp_template_snapshot") or {},
        current_audience=session.get("whatsapp_audience") or {},
    )
    mas_block = build_mas_runtime_context(session, module_hint=module_hint)
    if mas_task and isinstance(mas_task, dict):
        mas_block += f"\nmas_task_id: {mas_task.get('task_id')!r}"
    scope = (
        "MAS executor scope: whatsapp_approved_send. "
        "SET_AUDIENCE, FILTER_CONTACTS, UPLOAD_TEMPORARY_CONTACTS, "
        "SEND_APPROVED_TEMPLATE, LAUNCH_APPROVED_CAMPAIGN. "
        "Do not edit template copy."
    )
    skill_block = ""
    sid = str(skill_id or "").strip().lower()
    mod = str(skill_module or "").strip().lower()
    if sid and mod:
        from app.mas.skills.registry import get_skill_registry

        skill_body = get_skill_registry().prompt_for_skill(mod, sid)
        if skill_body:
            skill_block = f"\n\n### Active skill ({sid})\n{skill_body}"
    return (
        f"{base}\n\n### Executor scope\n{scope}{skill_block}\n\n### MAS runtime\n{mas_block}"
    )


def build_system_prompt(session: dict, **extra: object) -> str:
    from app.session_store import llm_session_snapshot

    snapshot = llm_session_snapshot(session)
    parts = [format_json_context('Session snapshot', snapshot)]
    for key, val in extra.items():
        if val is None:
            continue
        if isinstance(val, str) and val.strip():
            parts.append(val.strip())
        else:
            parts.append(format_json_context(str(key), val))
    try:
        from app.industry_packs.loader import prompt_addendum
        addendum = prompt_addendum(session.get('campaign_profile'), 'whatsapp_approved') or ''
    except Exception:
        addendum = ''
    try:
        from app.agents.create_campaign.prompts import (
            temporary_contact_template_link_html,
        )

        parts.append(
            "Temporary contact sheet sample (paste this HTML exactly when offering upload):\n"
            + temporary_contact_template_link_html()
        )
    except Exception:  # noqa: BLE001
        pass
    return sectioned_system_prompt(
        role=_ROLE,
        goal=_GOAL,
        instructions=_INSTRUCTIONS,
        context=join_context_parts(*parts),
        output=_OUTPUT,
        guardrails=_GUARDRAILS,
        extra_instructions=addendum,
    )

SYSTEM_PROMPT = sectioned_system_prompt(
    role=_ROLE,
    goal=_GOAL,
    instructions=_INSTRUCTIONS,
    context="(built per turn via build_system_prompt)",
    output=_OUTPUT,
    guardrails=_GUARDRAILS,
)

_WELCOME_VARIANTS = (
    "Hi — we'll send your Meta-approved WhatsApp template as-is. "
    "Who should receive it: CRM contacts, phone numbers with country code, or a temporary CSV?",
    "Welcome! This run uses your approved WhatsApp template unchanged. "
    "Tell me the audience — segments, pasted phones, or upload a temporary contact sheet.",
    "Hey — ready to launch an approved WhatsApp template. "
    "Who are we reaching? CRM filters, specific numbers, or a CSV upload works too.",
    "Good to see you. We'll deliver the approved WhatsApp message without editing copy. "
    "Who should get it — contacts from CRM, phone list, or temporary sheet?",
    "Hi there! I'll help you run an already-approved WhatsApp template. "
    "Start with who should receive it (CRM, phones with country code, or CSV).",
)


def welcome_text(
    template_name: str | None = None,
    campaign_name: str | None = None,
) -> str:
    """Generic join welcome — template/campaign names belong in the overview panel, not chat."""
    _ = template_name
    _ = campaign_name
    return random.choice(_WELCOME_VARIANTS)
