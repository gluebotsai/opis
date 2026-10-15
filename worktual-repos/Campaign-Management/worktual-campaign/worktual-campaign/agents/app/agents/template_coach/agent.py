"""Isolated Manual-Edit coach — no shared memory with other agents.

User idea is passed as an explicit snapshot (campaign + AI Edit chat +
current fields). This agent does not read create-campaign or template-edit
conversation history from session memory.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.agents.template_library.shared import get_llm, parse_json_object
from app.llm import CHAT_MAX_TOKENS, CHAT_REASONING_EFFORT
from app.prompt_sections import sectioned_system_prompt

SYSTEM_PROMPT = sectioned_system_prompt(
    role=(
        "You are Worktual Template Coach — a separate agent used only in Manual Edit. "
        "You do not share memory with create-campaign or AI Edit chat."
    ),
    goal=(
        "Help Manual Edit: rewrite selected copy on assist, and on save only "
        "auto-correct spelling/grammar. Return JSON only."
    ),
    instructions=(
        "You receive a SNAPSHOT: the user's campaign idea, optional AI Edit chat, the "
        "channel, and the current template.\n\n"
        "Jobs:\n"
        "1) ASSIST — rewrite selected editable copy when asked (shorter, more professional, "
        "B2B, alternatives, or a free instruction). Never change locked/static fields "
        "(merge tags like {{first_name}} / {{campaign_url}}, legal footer).\n"
        "2) SAVE_POLISH (also if MODE is save_review) — do NOT analyse tone vs idea. "
        "Only fix spelling, grammar, and obvious punctuation. Put corrected strings in "
        "field_patches using keys that exist (subject, body, title, header, greeting, "
        "cta_label). Keep meaning, merge tags, URLs, and layout. If already correct, "
        "field_patches={}. If a change is unsafe or you need a choice, set "
        "needs_input=true, question='one clear question', apply=false, field_patches={}.\n"
        "3) SAVE_CLARIFY — the user answered question in INSTRUCTION. Either return "
        "field_patches and needs_input=false, or explain in walkthrough what still "
        "cannot be done and keep needs_input=true with a follow-up question.\n"
        "- apply=true to change selected text (assist) or when field_patches should be "
        "written into the template (save_polish / save_clarify).\n"
        "- Preserve {{merge_tags}}."
    ),
    context="(injected per call in the user message SNAPSHOT)",
    output=(
        "Reply JSON only:\n"
        "{\n"
        '  "ok": true,\n'
        '  "walkthrough": "1-3 short sentences",\n'
        '  "issues": [],\n'
        '  "apply": false,\n'
        '  "corrected_content": null,\n'
        '  "field_patches": {},\n'
        '  "needs_input": false,\n'
        '  "question": ""\n'
        "}"
    ),
    guardrails=(
        "Never change locked/static merge tags or legal footer. "
        "Do not share memory with other agents."
    ),
)

_WHATSAPP_COACH_RULES = """
When CHANNEL is whatsapp — Meta template rules for every patch:
- Plain text only in header/body/footer/buttons (no HTML).
- FOOTER: no {{variables}}.
- BODY: named placeholders only ({{first_name}}, {{campaign_url}}); never positional {{1}};
  never at the very start or end of body; never adjacent placeholders.
- Buttons: URL type only when a campaign https URL exists; otherwise do not add buttons.
- Keep the existing template "name" unchanged unless the user explicitly asked to rename.
"""


def _trim_chat(idea_chat: list[Any], limit: int = 12) -> str:
    rows: list[str] = []
    for msg in idea_chat[-limit:]:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "user")
        text = str(msg.get("text") or msg.get("content") or "").strip()
        if not text:
            continue
        rows.append(f"{role}: {text[:400]}")
    return "\n".join(rows) if rows else "(no AI Edit chat provided)"


def _compact_fields(
    fields: dict[str, Any] | None,
    *,
    str_limit: int = 600,
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in (fields or {}).items():
        if key in {"approval", "preview", "html", "components", "blocks"}:
            continue
        if isinstance(value, str):
            out[key] = value[:str_limit]
        elif isinstance(value, list) and key in {"paragraphs", "buttons"}:
            out[key] = value[:8]
        else:
            out[key] = value
    return out


async def run_template_coach(
    *,
    mode: str,
    channel: str,
    campaign: dict[str, Any] | None,
    fields: dict[str, Any] | None,
    selected: dict[str, Any] | None,
    idea_chat: list[Any] | None,
    instruction: str | None = None,
) -> dict[str, Any]:
    camp = campaign if isinstance(campaign, dict) else {}
    selected = selected if isinstance(selected, dict) else None
    locked = bool(selected and selected.get("locked"))
    mode_norm = (mode or "assist").strip().lower()
    if mode_norm == "save_review":
        mode_norm = "save_polish"
    instr = (instruction or "").strip()[:800]
    polish = mode_norm in {"save_polish", "save_clarify"}
    str_limit = 1800 if polish else 600

    user_payload = f"""MODE: {mode_norm}
CHANNEL: {(channel or "email").strip().lower()}
USER IDEA — campaign name: {camp.get("name") or "—"}
USER IDEA — goal: {camp.get("goal") or "—"}
USER IDEA — objective: {camp.get("objective") or "—"}
AI EDIT CHAT (the user's requests for this template):
{_trim_chat(list(idea_chat or []))}
INSTRUCTION: {instr or ("(none — auto-correct spelling/grammar)" if polish else "(none)")}
SELECTED: {selected}
SELECTED_LOCKED: {locked}
CURRENT FIELDS: {_compact_fields(fields if isinstance(fields, dict) else {}, str_limit=str_limit)}
"""

    ch = (channel or "email").strip().lower()
    system = SYSTEM_PROMPT
    if ch == "whatsapp":
        system = f"{SYSTEM_PROMPT}\n\n{_WHATSAPP_COACH_RULES.strip()}"

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_payload},
    ]

    def _call():
        return get_llm().run(
            messages,
            reasoning_effort=CHAT_REASONING_EFFORT,
            max_tokens=min(CHAT_MAX_TOKENS, 900 if polish else 512),
            temperature=0.25,
        )

    raw = await asyncio.to_thread(_call)
    parsed = parse_json_object(str((raw or {}).get("content") or "")) or {}
    walkthrough = str(parsed.get("walkthrough") or "").strip()
    issues_raw = parsed.get("issues")
    issues = (
        [str(i).strip() for i in issues_raw if str(i).strip()]
        if isinstance(issues_raw, list)
        else []
    )
    patches_raw = parsed.get("field_patches")
    field_patches = (
        {str(k): str(v) for k, v in patches_raw.items() if str(v).strip()}
        if isinstance(patches_raw, dict)
        else {}
    )
    apply_fix = bool(parsed.get("apply")) and not locked
    corrected = parsed.get("corrected_content")
    if corrected is not None:
        corrected = str(corrected).strip() or None
    ok = parsed.get("ok")
    if ok is None:
        ok = len(issues) == 0
    ok = bool(ok)
    needs_input = bool(parsed.get("needs_input"))
    question = str(parsed.get("question") or "").strip()
    if needs_input and not question:
        question = walkthrough or "Can we proceed with this wording?"
    if polish:
        # Save path: apply patches unless the model asked a question.
        if needs_input:
            apply_fix = False
            field_patches = {}
        elif field_patches:
            apply_fix = True
        ok = True
    if locked and not polish:
        apply_fix = False
        corrected = None
        field_patches = {}
    if not walkthrough:
        if polish and needs_input:
            walkthrough = question
        elif polish:
            walkthrough = (
                "Spelling and grammar checked."
                if not field_patches
                else "Spelling and grammar updated."
            )
        else:
            walkthrough = (
                "Template looks ready to save."
                if ok
                else "Fix the issues below, then save again."
            )

    alternatives = parsed.get("alternatives")
    alts = (
        [str(a).strip() for a in alternatives if str(a).strip()]
        if isinstance(alternatives, list)
        else []
    )

    return {
        "ok": ok,
        "walkthrough": walkthrough,
        "issues": issues[:6],
        "apply": apply_fix,
        "corrected_content": corrected if apply_fix else None,
        "field_patches": field_patches if apply_fix or (polish and not needs_input) else {},
        "needs_input": needs_input if polish else False,
        "question": question if polish and needs_input else "",
        "alternatives": alts[:4],
    }
