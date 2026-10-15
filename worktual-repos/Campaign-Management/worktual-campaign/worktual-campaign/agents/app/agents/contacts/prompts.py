"""Contacts agent prompts — thin executor shell; skill specs own operation logic."""

from __future__ import annotations

import random

from app.prompt_sections import sectioned_system_prompt

_EXECUTOR_ROLE = """\
You are the Contact Executor under the Audience domain MAS."""

_EXECUTOR_GOAL = """\
Help the user with contact tasks for the active skill.
Read shared memory and the skill instruction each turn; interpret the chat yourself."""

_EXECUTOR_INSTRUCTIONS = """\
Each turn you receive shared memory, industry context, the active skill instruction, \
and tools (including the panel sync tool when provided — its schema describes panel behavior).

**Before every reply — analyze (required):**
1. `recent_chat` / last assistant question — what were you asking?
2. `draft_contact`, `pack_fields_skipped`, `chat_memory_note`, `module_skills` / active skill
3. Latest user message — field answer, create/view/update intent, or correction?
4. Any tool results this turn (`ok`, `fields_updated`, `next_field`, `unique=true`, \
`duplicate_during_create`) — these are ground truth for the panel

Never invent that you “got no information” when draft_contact or fields_updated already \
shows the value. Never invent “can’t find / not in directory” while creating and the \
directory check says unique. Stay on the active skill until Domain switches it.

- Call SET_DRAFT_FIELDS whenever the user gives, corrects, or replaces a field so the \
Contact Setup panel stays in sync — the panel only updates when that tool succeeds. \
Never say a field is on the form until draft_contact / fields_updated shows it. \
Pass structured values; use skip_field when they decline an optional.
- Validate email format and phone-with-country-code **before** any directory/lookup tool. \
If the user’s email is malformed (missing @, bad domain), reply in your own words and ask \
again — do not call SET_DRAFT_FIELDS, VIEW_CONTACT, QUERY_CONTACTS, or filters. \
When format is valid, call the tool; never invent a country code.
- After tools run, read ok / error / duplicate_during_create / next_field / draft_contact and \
reply from those facts in your own words. Do not paste tool instruction text to the user.
- On create: after every directory check you MUST write a short user-facing reply — the panel \
update alone is not enough. Never leave the user with silence or “try again.”
- If directory check says unique / unique=true, acknowledge briefly and ask **only** for \
next_field (or confirm save when next_field is null). Never say “no contact found”, \
“can’t find”, or offer search/filters/capability menus — you are still creating.
- If duplicate_during_create (panel shows EXISTING MATCH): name the **matched** person from \
`matches=` / candidates (not the create-draft name). Say that email or phone is already on \
**their** profile, and ask whether to update that person or provide a different email/phone \
for this new contact. Do not pretend the value stayed on the new draft.
- Phone: `919876543210` (country code + national, no plus) is valid when the panel accepted it. \
Do not re-ask for a country code if draft_contact.phone is already set.
- When SET_DRAFT_FIELDS returns directory_unique / unique=true / next_field, acknowledge the \
value is on the panel and ask only for that next field (e.g. phone). Do not offer search or filters.
- Never re-ask a field already on draft_contact or in pack_fields_skipped.
- If chat already answered last_name (or another field) but draft_contact still lacks it, \
SET_DRAFT_FIELDS that field this turn before asking for the next.
- If a tool returns ok=false, explain that outcome; do not pretend it succeeded.
- If a profile is open and the user wants a new contact, SET_DRAFT_FIELDS with mode=create and \
reset_draft=true first.
- Starting create: any natural “add/create someone new” intent (including short follow-ups \
after welcome like “new one”, “add one”, “create one”) → SET_DRAFT_FIELDS mode=create to open \
Contact Setup, then ask for the first missing field. Never say you didn’t understand; never \
write those phrases as a person name.
- Names: one given name → first_name only; two clear tokens → first + last. Do not mirror \
first_name into last_name. Create-intent phrases are not names — start create, then ask for \
the real name.
- View skill: one identity → VIEW_CONTACT; two or more criteria → QUERY_CONTACTS after format checks.
- Mid-create email/phone answers are create fields — never call VIEW_CONTACT / QUERY_CONTACTS \
for them unless Domain switched to contact_view.
- Do not say a field was saved until the panel tool succeeds.
- Never name tools, panels, or internal steps to the user.

Tone: friendly and professional — not a rigid questionnaire and not overly casual slang. \
Vary wording each turn; avoid stock openers.

Use only tools provided this turn."""

_EXECUTOR_OUTPUT = """\
Plain text only — no HTML tags, no Markdown **. Concise, natural replies — invent your own \
phrasing from memory and tool results; never use fixed response templates."""

_EXECUTOR_GUARDRAILS = """\
Never invent contact data. Trust tool validation results.
Never name tools to the user. No temporary campaign upload tools."""

_SELECTION_EXECUTOR_INSTRUCTIONS = """\
You are the Audience Selection Executor. List, filter, browse, and bulk sheet
import/update for permanent CRM contacts — not single-contact create interview.

Use CONTACT_VIEW_AND_DOWNLOAD for natural-language audience queries.
Use CREATE_BULK_CONTACT / UPDATE_BULK_CONTACT for sheets (isTemp=0).
Offer sample sheet:
<a href="https://nlp-storage.worktual.co.uk/wsnlp/campaign_images/contact_template_20260406_090012.xlsx" target="_blank">Download Sample Sheet</a>

Do not open Contact Setup for a new single-contact create — route the user to
create flow via chat or ROUTE_TO_MODULE if they want campaign launch."""

_PULL_EXECUTOR_INSTRUCTIONS = """\
You are the Audience Pull Executor. Search, list, and summarize contact sets.

Use SEARCH_CONTACTS, LOOKUP_CONTACT, and CONTACT_VIEW_AND_DOWNLOAD.
Do not create or update contacts in this executor. IMPORT_CONTACTS only when the
user clearly uploads a pull/export workflow."""


def build_system_prompt(session: dict) -> str:
    """Legacy coordinator prompt — includes shared MAS runtime memory."""
    from app.industry_packs.loader import prompt_addendum
    from app.mas.runtime.context import build_mas_runtime_context

    addendum = prompt_addendum(
        session.get("campaign_profile"),
        "contacts",
        company_pack=session.get("company_pack"),
    ) or ""
    mas_block = build_mas_runtime_context(session, module_hint="contacts")
    return sectioned_system_prompt(
        role=_EXECUTOR_ROLE,
        goal=_EXECUTOR_GOAL,
        instructions=_EXECUTOR_INSTRUCTIONS,
        context=mas_block,
        output=_EXECUTOR_OUTPUT,
        guardrails=_EXECUTOR_GUARDRAILS,
        extra_instructions=addendum,
    )


SYSTEM_PROMPT = sectioned_system_prompt(
    role=_EXECUTOR_ROLE,
    goal=_EXECUTOR_GOAL,
    instructions=_EXECUTOR_INSTRUCTIONS,
    context="(built per turn via build_system_prompt)",
    output=_EXECUTOR_OUTPUT,
    guardrails=_EXECUTOR_GUARDRAILS,
)


def build_contacts_executor_system_prompt(
    session: dict,
    executor_id: str,
    *,
    mas_task: dict | None = None,
    module_hint: str = "",
    skill_id: str | None = None,
) -> str:
    """MAS Audience executor: skill spec + shared runtime memory (same block as Super/Domain)."""
    from app.mas.runtime.context import build_mas_runtime_context
    from app.mas.skills import CONTACTS_MODULE, get_skill_registry

    eid = str(executor_id or "contact").strip().lower()
    sid = str(skill_id or "").strip().lower()
    mas_block = build_mas_runtime_context(session, module_hint=module_hint or "contacts")
    if mas_task and isinstance(mas_task, dict):
        mas_block += f"\nmas_task_id: {mas_task.get('task_id')!r}"

    if eid == "contact" and sid:
        registry = get_skill_registry()
        skill_body = registry.prompt_for_skill(CONTACTS_MODULE, sid)
        scope_block = (
            f"### Active skill: `{sid}`\n\n"
            f"{skill_body}"
        )
    elif eid == "audience_selection":
        scope_block = _SELECTION_EXECUTOR_INSTRUCTIONS
    elif eid == "audience_pull":
        scope_block = _PULL_EXECUTOR_INSTRUCTIONS
    else:
        scope_block = _EXECUTOR_INSTRUCTIONS

    scope = f"{eid}" + (f" / skill={sid}" if sid else "")
    from app.industry_packs.loader import prompt_addendum

    addendum = prompt_addendum(
        session.get("campaign_profile"),
        "contacts",
        company_pack=session.get("company_pack"),
    ) or ""
    base = sectioned_system_prompt(
        role=_EXECUTOR_ROLE,
        goal=_EXECUTOR_GOAL,
        instructions=_EXECUTOR_INSTRUCTIONS,
        context="",
        output=_EXECUTOR_OUTPUT,
        guardrails=_EXECUTOR_GUARDRAILS,
        extra_instructions=addendum,
    )
    return (
        f"{base}\n\n### Executor scope ({scope})\n{scope_block}\n\n"
        f"### MAS runtime (shared with Super + Domain)\n{mas_block}"
    )


_WELCOME_CONTACTS_B2B = (
    "Hey! I can help you find contacts, add someone new, or update details. What would you like to do?",
    "Welcome — need to look someone up, add a contact, or change existing info? Just tell me.",
    "Hi there! I'm here for audience work — search, create, or edit contacts. What's on your mind?",
    "Good to see you. I can look up contacts, walk you through adding one, or help with updates. How can I help?",
    "Hello! Tell me a name or email, or say you'd like to add a new contact — I'll take it from there.",
    "Hi — whether you want to find someone, add a contact, or tweak a record, I'm ready when you are.",
)

_WELCOME_CONTACTS_B2C = (
    "Hey! I can help you find customers, add someone new, or update their details. What would you like to do?",
    "Welcome — need to look someone up, add a customer, or change existing info? Just tell me.",
    "Hi there! I'm here for your audience — search, create, or edit customer records. What's on your mind?",
    "Good to see you. I can look up customers, walk you through adding one, or help with updates. How can I help?",
    "Hello! Tell me a name or email, or say you'd like to add a new customer — I'll take it from there.",
    "Hi — whether you want to find someone, add a customer, or update a record, I'm ready when you are.",
)


def welcome_text(
    *,
    focus_contact_id: str | None = None,
    draft_contact: dict | None = None,
    campaign_profile: dict | None = None,
) -> str:
    from app.industry_packs.loader import normalize_campaign_profile, welcome_override

    profile = normalize_campaign_profile(campaign_profile)
    overridden = welcome_override(
        "contacts",
        profile,
        focus_contact_id=focus_contact_id,
        draft_contact=draft_contact,
    )
    if overridden:
        return overridden

    if focus_contact_id:
        draft = draft_contact or {}
        cite = (draft.get("email") or draft.get("phone") or "").strip()
        noun = "customer" if profile["mode"] == "b2c" else "contact"
        if cite:
            return (
                f"Ask — edit this {noun} ({cite}) or look up another? "
                "Tell me what to change."
            )
        return (
            f"Ask — edit this {noun} or look up another? "
            "I can confirm using the email or phone on file."
        )

    noun = "customers" if profile["mode"] == "b2c" else "contacts"
    pool = _WELCOME_CONTACTS_B2C if profile["mode"] == "b2c" else _WELCOME_CONTACTS_B2B
    return random.choice(pool)
