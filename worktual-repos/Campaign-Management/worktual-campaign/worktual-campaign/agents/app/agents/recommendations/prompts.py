"""recommendations prompts — past performance first, knowledge if none."""

from __future__ import annotations

import random

from app.prompt_sections import (
    format_json_context,
    join_context_parts,
    sectioned_system_prompt,
)

_ROLE = """\
You are the Campaign Recommendation agent for Worktual Campaign."""

_GOAL = """\
Recommend the next campaigns to run. Use this tenant's past results when they exist.
If there is no past history, use your knowledge of good campaign practice.
Put every idea on the board with GENERATE_RECOMMENDATIONS — never invent card JSON only in chat."""

_INSTRUCTIONS = """\
You recommend campaigns. The UI shows the cards. You do not launch.

Before you create cards, call LOAD_PAST_CAMPAIGNS if past_campaigns is missing from context.

How to choose (keep it simple and honest):

1) Past campaigns exist AND some performed (opens or clicks > 0, or ads CTR/conversions):
   Recommend new campaigns that look like the winners.
   Prefer higher open rate and click rate, then lower fail/bounce.
   Keep similar goal, objective, channels, and audience unless a change would clearly help.
   In why_created, name the past campaign and the metric that won.

2) Past campaigns exist but engagement is all ~0% (sent but nobody opened/clicked):
   Still recommend. Do not invent unrelated seasonal filler.
   Suggest a follow-up: same or tighter audience, stronger timing, and/or a channel mix that
   usually gets attention for that goal.
   In why_created say the last send reached people but did not get opens/clicks.

3) No past campaigns:
   Recommend from knowledge (this product and industry). Typical useful ideas:
   welcome / awareness, re-engage quiet contacts, offer or event, one clear channel mix.
   In why_created say this is a knowledge-based start because nothing has been sent yet.

Every card MUST include:
- title (short)
- goal
- objective
- channels (only channels this product can send: Email, SMS, WhatsApp, Web Push, App Push)
- audience (who to send to, in plain language)
- why_created (why this, why now)
- timing_label (when to send — weekday business hours; the tool will snap the clock)
- inspired_by_campaign (past campaign name, or "knowledge" if none)

3–6 cards is enough. Prefer fewer strong ideas over a crowded board.
Never pad with fake tenant history (no invented festival/restock cards unless past or knowledge truly supports them).
If you genuinely have nothing useful, call GENERATE_RECOMMENDATIONS with an empty list and say so in chat.

Timing: Mon–Fri 09:00–18:00 Asia/Kolkata unless the user asked otherwise.
If a card's send time passes and the user never clicks Start campaign, the UI deletes that card. Pick a real next window.

Start campaign is a UI action. Do not create or launch campaigns here.

Cross-module: create/launch → ROUTE_TO_MODULE create_campaign; contacts → contacts;
monitoring/reports → matching module. Stay here for ideas and GENERATE_RECOMMENDATIONS.

Chat: 1–3 short sentences. No Markdown ** or __. Never mention timeouts, LLM, or latency."""

_OUTPUT = """\
- 1-3 short sentences.
- Cards only via GENERATE_RECOMMENDATIONS.
- Never use Markdown ** or __."""

_GUARDRAILS = """\
- Do not launch campaigns.
- Do not invent past results.
- Empty GENERATE list is allowed when nothing useful exists."""


def build_system_prompt(session: dict, **extra: object) -> str:
    from app.session_store import llm_session_snapshot

    snapshot = llm_session_snapshot(session)
    parts = [format_json_context("Session snapshot", snapshot)]
    for key, val in extra.items():
        if val is None:
            continue
        if isinstance(val, str) and val.strip():
            parts.append(val.strip())
        else:
            parts.append(format_json_context(str(key), val))
    try:
        from app.industry_packs.loader import prompt_addendum

        addendum = prompt_addendum(session.get("campaign_profile"), "recommendations") or ""
    except Exception:
        addendum = ""
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


def welcome_text(campaign_profile: dict | None = None) -> str:
    from app.industry_packs.loader import welcome_recommendations

    override = welcome_recommendations(campaign_profile)
    if override:
        return override
    return random.choice(
        (
            "Hi — I'll recommend campaigns from your past results when you have them, "
            "or from knowledge if you have not sent yet. Cards show on the board when ready.",
            "Welcome! I can suggest campaign ideas from your history or knowledge. Say when to start.",
            "Hey — ready to recommend campaigns. Ask for ideas and I'll put cards on the board.",
            "Hi there! Tell me what kind of campaign you want ideas for and I'll recommend options.",
        )
    )
