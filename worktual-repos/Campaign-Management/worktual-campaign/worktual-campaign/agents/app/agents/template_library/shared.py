"""Shared helpers for template_library channel agents (no keyword intent matching)."""

from __future__ import annotations

import html
import json
import re
from typing import Any

from app.config import get_settings
from app.llm import GEN_MAX_TOKENS, GEN_REASONING_EFFORT, OpenAILLM
from app.shared_prompts import SHARED_CLARIFY_INSTRUCTIONS
from app.text_cleanup import strip_markdown_emphasis

INTERNAL_CONTEXT_RULES = f"""
INTERNAL PLANNING CONTEXT (use to invent customer copy — never paste these strings):
- Campaign name, goal, and objective are for YOUR planning only.
- Infer the customer offer/event/benefit from that intent, then write fresh marketing copy.
- CTA: analyze chat, knowledge, and form/landing URLs. Include a button/link only when
  the user asked for a click or a real http(s) product/form URL is in facts. Knowledge
  with no links is not a reason to invent Shop / Learn more / {{campaign_url}} buttons.
- Do NOT paste the campaign name, goal, or objective verbatim into the template.
- Do NOT write lines like "We're launching <campaign name>", "Goal: …", "Objective: …",
  "Channel: email", or "Audience size: N".
- Customers should never see internal campaign labels — only natural offer language.
- Never use Markdown (** or __). Never wrap the whole reply in code fences.

{SHARED_CLARIFY_INSTRUCTIONS}
- Edit-space is a single channel agent — no multi-agent routing. If the ask is not about
  editing this template, ask one clarifying question instead of inventing unrelated edits.
"""

FINANCE_COPY_RULES = """
FINANCE / CONSUMER COPY (critical when industry=finance):
- Write for retail banking / payments customers — not B2B accounts or job titles.
- Tone: clear, helpful, trustworthy marketing. Prefer offers, upgrades, savings,
  festive rewards, referrals, and product cross-sell language when the campaign intent matches.
- Do NOT default to EMI due, KYC ops, or statement-ready service copy unless the user
  explicitly asked for a service/ops message.
- Do NOT invent interest rates, fees, APRs, cashback %, or regulatory claims.
- If promoting credit/cards, keep benefits factual and suggest a short disclaimer line
  when appropriate (e.g. subject to eligibility / T&Cs).
- Prefer {{first_name}} only; do not use {{company}} / {{job_title}}.
"""

# Soft PDOA — personalization placeholders (default first_name only).
PDOA_MERGE_TAG_RULES = """
SOFT PDOA — MERGE TAGS / PLACEHOLDERS:
- DEFAULT: use only {{first_name}} for personalization (e.g. Hi {{first_name}},).
- Links may use {{campaign_url}} when a CTA URL is needed.
- Do NOT use {{company}}, {{city}}, {{job_title}}, {{company_name}}, or other contact
  merge tags unless the user explicitly asked for that placeholder in this request.
- DYNAMIC OFFERS: when personalization mode is dynamic_offer (or the user/create-campaign
  agent enabled product personalization), email/push MAY also use:
  {{product_name}}, {{product_url}}, {{product_image}}, {{product_price}}, {{product_id}}.
  {{campaign_url}} then prefers the per-contact product URL.
  WhatsApp: do NOT add new product_* placeholders that would require Meta re-approval;
  only use tags already planned for the approved template body.
- If the user did not mention extra placeholders or dynamic offers, omit them entirely.
"""


def finance_copy_block(campaign: dict[str, Any] | None) -> str:
    camp = campaign if isinstance(campaign, dict) else {}
    industry = str(camp.get("industry") or "").strip().lower()
    if industry in ("finance", "fintech", "banking"):
        return FINANCE_COPY_RULES
    return ""

def compact_prior_fields(
    fields: dict[str, Any] | None, *, max_len: int = 2500
) -> dict[str, Any]:
    """Shrink past template fields for LLM improve-from context."""
    out: dict[str, Any] = {}
    for key, value in (fields or {}).items():
        if key in {"approval", "preview", "html", "components", "body_placeholders"}:
            continue
        if isinstance(value, str) and len(value) > max_len:
            out[key] = value[:max_len] + "…"
        elif isinstance(value, list) and key == "paragraphs":
            out[key] = [str(p)[:800] for p in value[:8]]
        else:
            out[key] = value
    return out


def get_llm() -> OpenAILLM:
    settings = get_settings()
    return OpenAILLM(
        api_key=settings.llm_api_key,
        model_name=settings.llm_model,
        base_url=settings.llm_base_url,
    )


def clean_html(value: str, channel: str) -> str:
    value = strip_markdown_emphasis((value or "").strip())
    value = re.sub(r"^```(?:html|json)?\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*```$", "", value)
    if not value:
        return ""
    if "<" not in value or ">" not in value:
        return (
            f'<section data-channel="{html.escape(channel)}">'
            f"<p>{html.escape(value)}</p></section>"
        )
    return value


def context_block(
    campaign: dict[str, Any],
    audience_summary: dict[str, Any] | None = None,
    plan: dict[str, Any] | None = None,
    knowledge: str | None = None,
) -> str:
    audience_summary = audience_summary or {}
    plan = plan or {}
    kb = (knowledge or "").strip()
    kb_section = ""
    if kb:
        kb_section = f"""
=== CAMPAIGN KNOWLEDGE BASE (temporary — use for accurate product/offer facts) ===
Ground template copy in these facts when they relate to the campaign offer.
Paraphrase into natural customer language; do NOT dump raw KB text or paste
internal campaign name/goal/objective labels.
{kb}
"""
    brief = plan.get("creative_brief") if isinstance(plan.get("creative_brief"), dict) else {}
    narrative = str(brief.get("narrative") or "").strip()
    narrative_block = ""
    if narrative:
        narrative_block = f"""
=== CREATIVE REQUIREMENT NARRATIVE (follow this — do not invent facts) ===
{narrative}
"""
    design = plan.get("design_plan") if isinstance(plan.get("design_plan"), dict) else {}
    design_block = ""
    if design:
        design_block = f"""
=== DESIGN PLAN (structure is LOCKED — fill copy into this layout) ===
{json.dumps(design, ensure_ascii=False, indent=2)}
"""
    policy_rules = plan.get("company_rules") if isinstance(plan.get("company_rules"), list) else []
    rules_block = ""
    if policy_rules:
        rules_block = (
            "=== COMPANY RULES ===\n"
            + "\n".join(f"- {str(r).strip()}" for r in policy_rules if str(r).strip())
            + "\n"
        )
    common = plan.get("create_common") if isinstance(plan.get("create_common"), dict) else {}
    memory = str(common.get("memory_note") or plan.get("memory_note") or "").strip()
    memory_block = f"Memory note (INTERNAL): {memory}\n" if memory else ""
    user_note = str(plan.get("user_note") or "").strip()
    user_note_block = (
        f"Channel-specific user request (follow for this channel only): {user_note}\n"
        if user_note
        else ""
    )
    ready_url = str(plan.get("ready_image_url") or "").strip()
    if not ready_url:
        image = plan.get("image") if isinstance(plan.get("image"), dict) else {}
        if str(image.get("mode") or "") == "ready":
            ready_url = str(image.get("image_url") or "").strip()
    image_block = ""
    if ready_url:
        image_block = (
            "READY IMAGE URL (already generated/uploaded — use this exact URL in "
            f"image/header fields; do not invent another URL):\n{ready_url}\n"
        )
    compliance = (
        plan.get("compliance")
        if isinstance(plan.get("compliance"), dict)
        else (common.get("compliance") if isinstance(common.get("compliance"), dict) else {})
    )
    compliance_block = ""
    if compliance:
        compliance_block = (
            "=== COMPLIANCE (placeholder — follow when rules are present) ===\n"
            f"{json.dumps(compliance, ensure_ascii=False)}\n"
        )
    return f"""
=== INTERNAL CONTEXT (planning only — do not copy these labels into the template) ===
Campaign name (INTERNAL): {campaign.get("name") or common.get("name") or "—"}
Goal (INTERNAL): {campaign.get("goal") or common.get("goal") or "—"}
Objective (INTERNAL): {campaign.get("objective") or common.get("objective") or "—"}
Audience filters (INTERNAL): {audience_summary.get("description") or audience_summary.get("filters") or common.get("audience_summary") or "—"}
Matched count (INTERNAL): {audience_summary.get("matched_count") or 0}
Channel plan note (INTERNAL): {plan.get("how_it_works") or "—"}
{memory_block}{user_note_block}{image_block}{narrative_block}{design_block}{rules_block}{compliance_block}{kb_section}
{INTERNAL_CONTEXT_RULES}
"""


def parse_llm_run_result(result: dict[str, Any] | None) -> dict[str, Any] | None:
    """Parse JSON from LLM message content, then reasoning when content is empty."""
    if not isinstance(result, dict):
        return None
    data = parse_json_object(result.get("content") or "")
    if data:
        return data
    reasoning = result.get("reasoning")
    if isinstance(reasoning, str) and reasoning.strip():
        return parse_json_object(reasoning)
    if isinstance(reasoning, dict):
        nested = reasoning.get("content") or reasoning.get("text") or ""
        if isinstance(nested, str) and nested.strip():
            return parse_json_object(nested)
    return None


def parse_json_object(raw: str) -> dict[str, Any] | None:
    """Extract a JSON object from an LLM reply. No keyword heuristics."""
    text = strip_markdown_emphasis((raw or "").strip())
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    if not text:
        return None
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start : end + 1])
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None
    return None
