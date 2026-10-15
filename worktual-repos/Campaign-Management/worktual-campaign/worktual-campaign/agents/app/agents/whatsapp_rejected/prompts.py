"""whatsapp_rejected prompts — 6-section structure with dynamic Context."""

from __future__ import annotations

from app.prompt_sections import (
    format_json_context,
    join_context_parts,
    sectioned_system_prompt,
)

_ROLE = """\
You are the Rejected WhatsApp Template agent for Worktual Campaign."""

_GOAL = """\
Fix a Meta-rejected WhatsApp template and resubmit for approval."""

_INSTRUCTIONS = """\
You are the Rejected WhatsApp Template agent for Worktual Campaign.
You ONLY help users fix a Meta-rejected WhatsApp template and resubmit it for approval.
You are NOT the create-campaign agent and you do NOT launch campaigns.
Users may arrive from a template-compliance alert (rejected / paused / stale Meta status).

Session snapshot includes the rejected template fields and rejected_reason when known.

Flow:
1) Explain briefly that the template was rejected (cite rejected_reason if present).
2) Ask what to change (body, header, footer, buttons, or name).
3) When the user provides new copy, call SET_TEMPLATE_FIELDS immediately.
4) Meta requires a unique template name — if resubmitting the same content, suggest a new
   lowercase name with underscores (e.g. original_v2).
5) After fields look good, ask "Submit for Meta approval? (yes/no)".
6) Only on explicit yes → call SUBMIT_FOR_APPROVAL.
7) Short replies. One question at a time. Plain text only — no Markdown ** or __."""

_OUTPUT = """\
- Short replies. One question at a time. Plain text only — no Markdown ** or __."""

_GUARDRAILS = """\
- NOT create-campaign. Do not launch campaigns.
- SUBMIT_FOR_APPROVAL only after explicit yes."""


def build_whatsapp_rejected_executor_system_prompt(
    session: dict,
    *,
    mas_task: dict | None = None,
    module_hint: str = "",
) -> str:
    """Bounded executor prompt for content_verification MAS executor."""
    from app.mas.runtime.context import build_mas_runtime_context

    base = build_system_prompt(
        session,
        rejected_template_snapshot=session.get("whatsapp_template_snapshot") or {},
    )
    mas_block = build_mas_runtime_context(session, module_hint=module_hint)
    if mas_task and isinstance(mas_task, dict):
        mas_block += f"\nmas_task_id: {mas_task.get('task_id')!r}"
    scope = (
        "MAS executor scope: content_verification. "
        "Only SET_TEMPLATE_FIELDS and SUBMIT_FOR_APPROVAL. "
        "Do not launch campaigns."
    )
    return f"{base}\n\n### Executor scope\n{scope}\n\n### MAS runtime\n{mas_block}"


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
        addendum = prompt_addendum(session.get('campaign_profile'), 'whatsapp_rejected') or ''
    except Exception:
        addendum = ''
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

def welcome_text(template_name: str | None = None, reason: str | None = None) -> str:
    t = (template_name or "this template").strip()
    r = (reason or "").strip()
    if r:
        return (
            f"“{t}” was rejected ({r}). Tell me what to change in the message — "
            "I'll update the draft, then we can submit for approval again."
        )
    return (
        f"“{t}” was rejected by Meta. Tell me what to change — "
        "I'll update the draft, then we can submit for approval again."
    )
