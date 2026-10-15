"""Base channel agent: LLM generate + LLM edit (structured fields JSON)."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.agents.template_library.fields import (
    GENERATE_SCHEMA_HINTS,
    fields_are_usable,
    normalize_fields,
)
from app.agents.template_library.shared import (
    INTERNAL_CONTEXT_RULES,
    PDOA_MERGE_TAG_RULES,
    compact_prior_fields,
    context_block,
    finance_copy_block,
    get_llm,
    parse_json_object,
    parse_llm_run_result,
)
from app.llm import GEN_MAX_TOKENS, GEN_REASONING_EFFORT

_log = logging.getLogger(__name__)

try:
    from app.agents.template_generation_director.schemas import (
        align_email_fields_to_design_plan,
        email_fields_contain_builtin_placeholders,
        validate_email_structure,
    )
except Exception:  # noqa: BLE001
    align_email_fields_to_design_plan = None  # type: ignore[assignment,misc]
    email_fields_contain_builtin_placeholders = None  # type: ignore[assignment,misc]
    validate_email_structure = None  # type: ignore[assignment,misc]


def _ensure_email_subject(fields: dict[str, Any]) -> dict[str, Any]:
    """Fill subject from headline when the model returns null/empty subject."""
    out = dict(fields or {})
    subject = str(out.get("subject") or "").strip()
    if subject:
        out["subject"] = subject[:120]
        return out
    for row in out.get("sections") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("type") or "").strip().lower() != "headline":
            continue
        headline = str(row.get("content") or "").strip()
        if headline:
            out["subject"] = headline[:120]
            return out
    out["subject"] = "An update for you"
    return out


try:
    from app.agents.template_library.channels.whatsapp.meta_rules import (
        validate_whatsapp_fields,
        validate_whatsapp_layout,
    )
except Exception:  # noqa: BLE001
    validate_whatsapp_fields = None  # type: ignore[assignment]
    validate_whatsapp_layout = None  # type: ignore[assignment,misc]


class ChannelAgent:
    """One LLM agent per channel for generate + conversational edit."""

    channel: str = "web"
    system_prompt: str = ""

    async def generate(
        self,
        campaign: dict[str, Any],
        audience_summary: dict[str, Any],
        plan: dict[str, Any],
        knowledge: str | None = None,
        prior_template: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        schema_hint = GENERATE_SCHEMA_HINTS.get(self.channel) or "Return JSON fields."
        design = (
            plan.get("design_plan") if isinstance(plan.get("design_plan"), dict) else {}
        )
        image_specs_block = ""
        specs = design.get("image_slot_specs") if isinstance(design.get("image_slot_specs"), list) else []
        if specs and self.channel == "email":
            image_specs_block = (
                "IMAGE SLOT PLAN (fill matching image sections in order — placeholders only):\n"
                + json.dumps(specs, ensure_ascii=False)
                + "\n\n"
            )
        visual_block = ""
        brief = plan.get("creative_brief") if isinstance(plan.get("creative_brief"), dict) else {}
        vdi = str(brief.get("visual_design_intent") or plan.get("visual_design_intent") or "").strip()
        if vdi:
            visual_block = f"VISUAL DESIGN INTENT:\n{vdi}\n\n"
        ab_test = bool(
            isinstance(plan, dict)
            and (plan.get("ab_test") or plan.get("ab_enabled"))
        )
        if self.channel == "email" and design.get("sections") and not ab_test:
            schema_hint = GENERATE_SCHEMA_HINTS.get("email_sections") or schema_hint
        elif self.channel == "email" and ab_test:
            if design.get("sections"):
                schema_hint = (
                    GENERATE_SCHEMA_HINTS.get("email_ab_sections")
                    or GENERATE_SCHEMA_HINTS.get("email_ab")
                    or schema_hint
                )
            else:
                schema_hint = GENERATE_SCHEMA_HINTS.get("email_ab") or schema_hint
        elif self.channel == "whatsapp" and design.get("meta_layout"):
            schema_hint = GENERATE_SCHEMA_HINTS.get("whatsapp_preset") or schema_hint
        elif self.channel == "push" and design.get("content_flow"):
            schema_hint = GENERATE_SCHEMA_HINTS.get("push_native") or schema_hint
        elif self.channel == "web" and design.get("content_flow"):
            schema_hint = GENERATE_SCHEMA_HINTS.get("web_native") or schema_hint
        profile = (
            plan.get("industry_profile")
            if isinstance(plan.get("industry_profile"), dict)
            else {}
        )
        profile_block = ""
        if profile:
            try:
                from app.industry_packs.loader import prompt_addendum

                addendum = prompt_addendum(profile, "create_campaign") or ""
                if addendum.strip():
                    profile_block = f"\n=== LOGIN / INDUSTRY CONTEXT ===\n{addendum.strip()}\n"
            except Exception:  # noqa: BLE001
                pass
        lib = (plan or {}).get("library_format") if isinstance(plan, dict) else None
        format_block = ""
        if isinstance(lib, dict) and (lib.get("name") or lib.get("body_preview")):
            format_block = (
                "FORMAT REFERENCE (follow this template's structure/layout/style; "
                "replace content with fresh KB-based marketing copy):\n"
                f"- Name: {lib.get('name') or ''}\n"
                f"- Description: {lib.get('description') or ''}\n"
                f"- Preview cues: {lib.get('body_preview') or ''}\n"
                f"- Notes: {lib.get('format_notes') or ''}\n\n"
            )
        creative_policy = (
            plan.get("creative_policy")
            if isinstance(plan, dict) and isinstance(plan.get("creative_policy"), dict)
            else {}
        )
        content_mode = str(creative_policy.get("content_mode") or "").strip().lower()
        design_mode = str(creative_policy.get("design_mode") or "").strip().lower()
        if content_mode == "keep" and design_mode == "rewrite":
            format_block = (
                "CREATIVE POLICY: keep the marketing message/copy intent from the prior "
                "template; rewrite layout/structure only.\n\n"
            ) + format_block
        elif content_mode == "rewrite" and design_mode == "keep":
            format_block = (
                "CREATIVE POLICY: keep the prior layout/structure/CTA pattern; "
                "rewrite marketing copy for this campaign.\n\n"
            ) + format_block
        elif content_mode == "rewrite" and design_mode == "rewrite":
            format_block = (
                "CREATIVE POLICY: rewrite both content and design — fresh copy and layout.\n\n"
            ) + format_block
        critique_block = ""
        failures = plan.get("critique_failures") if isinstance(plan.get("critique_failures"), list) else []
        clean_failures = [str(v).strip() for v in failures if str(v).strip()]
        if clean_failures:
            critique_block = (
                "STYLE CRITIC FAILURES TO FIX:\n"
                + "\n".join(f"- {line}" for line in clean_failures[:6])
                + "\n\n"
            )
        prior_block = ""
        prior_fields = (
            prior_template.get("fields")
            if isinstance(prior_template, dict)
            and isinstance(prior_template.get("fields"), dict)
            else None
        )
        regenerate_layout = bool(plan.get("regenerate_layout"))
        preserve_content = bool(plan.get("preserve_content"))
        if prior_fields:
            compact = compact_prior_fields(prior_fields)
            if preserve_content and regenerate_layout:
                prior_block = (
                    "PRIOR TEMPLATE (keep marketing message/CTA intent; rewrite layout "
                    "only — new structure/section order. Preserve offer facts):\n"
                    f"{json.dumps(compact, ensure_ascii=False)}\n\n"
                )
            elif regenerate_layout or design:
                prior_block = (
                    "PRIOR TEMPLATE (regenerate — the NEW design plan controls structure; "
                    "do NOT reuse the old layout/pattern/section order. Write fresh copy "
                    "for the planned structure only. You may reuse factual ideas, not the "
                    "old skeleton. Do NOT paste old body verbatim. For WhatsApp invent a "
                    "new snake_case Meta name):\n"
                    f"{json.dumps(compact, ensure_ascii=False)}\n\n"
                )
            else:
                prior_block = (
                    "IMPROVE FROM PAST TEMPLATE (user did not like the previous cards; "
                    "analyse this ran/created template, keep a stronger version of its "
                    "format/structure/CTA pattern, then write BETTER copy for this campaign. "
                    "Do NOT paste the old body verbatim. Do NOT reuse a WhatsApp Meta "
                    f"template name — invent a new snake_case name if channel is whatsapp):\n"
                    f"{json.dumps(compact, ensure_ascii=False)}\n\n"
                )
        wa_url_block = ""
        wa_names_block = ""
        wa_rules_block = ""
        if self.channel == "whatsapp":
            form_url = str(
                campaign.get("form_url") or campaign.get("cta_url") or ""
            ).strip()
            if form_url.lower().startswith("https://"):
                wa_url_block = (
                    f"CAMPAIGN URL FOR BUTTONS (required — one URL button): {form_url}\n\n"
                )
            else:
                wa_url_block = (
                    "CAMPAIGN URL FOR BUTTONS: NONE — set \"buttons\": [] (no buttons).\n\n"
                )
            taken = plan.get("whatsapp_taken_names") if isinstance(plan, dict) else None
            if isinstance(taken, list) and taken:
                names_line = ", ".join(str(n).strip().lower() for n in taken[:80] if str(n).strip())
                if names_line:
                    wa_names_block = (
                        "TAKEN META NAMES (already on this WhatsApp account — do NOT reuse; "
                        f"pick a different snake_case name): {names_line}\n\n"
                    )
            try:
                from app.agents.template_library.channels.whatsapp.meta_rules import (
                    meta_rules_prompt_block,
                )

                wa_rules_block = meta_rules_prompt_block() + "\n\n"
            except Exception:  # noqa: BLE001
                wa_rules_block = ""
        prompt = f"""Create a fresh customer-facing {self.channel} template as structured
key/value fields (not HTML). For WhatsApp, output Meta-submit plain text only
(name/language/category/header/body/footer/buttons) — never HTML tags.

From the INTERNAL campaign goal/objective and any CAMPAIGN KNOWLEDGE BASE facts,
invent natural customer-facing marketing copy: what the offer/event is for the reader,
why it matters to them, and what to do next.
Prefer concrete product benefits from the knowledge base when relevant to this campaign.

HARD RULE — never leak campaign setup into the template:
- Goal, objective, and other internal brief lines are INPUT only — rewrite them into
  shopper/subscriber language. Never paste those strings (or close paraphrases that
  sound like a campaign brief, e.g. "promote … to the audience", "convert them into
  buyers", "drive sales") into subject, headline, body, bullets, or CTAs.
- Do NOT paste the campaign name as the whole subject/headline unless it already reads
  like a customer offer title; prefer a fresh marketing hook.
- Do NOT paste raw knowledge-base blocks verbatim — rewrite as marketing copy.

Quality bar for {self.channel}:
- Content must be complete and usable as-is.
- Greeting-only or empty-benefit copy is INVALID.
{PDOA_MERGE_TAG_RULES}
{finance_copy_block(campaign)}

{wa_rules_block}{wa_url_block}{wa_names_block}{visual_block}{image_specs_block}{critique_block}{prior_block}{format_block}{profile_block}{context_block(campaign, audience_summary, plan, knowledge)}

{schema_hint}

Return ONLY one JSON object with those fields.
No Markdown. No explanations.
"""
        last_fields: dict[str, Any] | None = None
        last_errors: list[str] = []
        for attempt in range(3):
            extra = ""
            if attempt:
                meta_hint = ""
                if (
                    self.channel == "whatsapp"
                    and validate_whatsapp_fields is not None
                    and last_fields is not None
                ):
                    _ok, errs = validate_whatsapp_fields(last_fields, strict=True)
                    if errs:
                        meta_hint = (
                            " Meta rule failures to fix: "
                            + "; ".join(errs[:6])
                        )
                struct_hint = ""
                if last_errors:
                    struct_hint = " Structure failures to fix: " + "; ".join(last_errors[:4])
                extra = (
                    "\nPrevious attempt FAILED quality checks "
                    "(too thin / greeting-only / missing offer / Meta rules / design plan)."
                    f"{meta_hint}{struct_hint} "
                    "Return a COMPLETE body with real offer copy inferred from the "
                    "internal goal and knowledge base — still do NOT paste campaign "
                    "name/goal/objective strings or brief-style lines "
                    "(\"promote to the audience\", \"convert buyers\", \"drive sales\") "
                    "or dump raw KB text. Obey Meta WhatsApp rules "
                    "and the DESIGN PLAN section order exactly."
                )
            fields = await self._llm_fields(prompt + extra)
            if not fields:
                last_errors = list(last_errors) + [
                    "LLM returned empty or invalid JSON"
                ]
                # Keep any prior partial fields; do not wipe them with None.
                continue
            last_fields = fields
            if (
                self.channel == "email"
                and design.get("sections")
                and align_email_fields_to_design_plan is not None
            ):
                fields = normalize_fields(
                    self.channel,
                    align_email_fields_to_design_plan(
                        fields,
                        design,
                        campaign=campaign,
                    ),
                )
                last_fields = fields
                if (
                    email_fields_contain_builtin_placeholders is not None
                    and email_fields_contain_builtin_placeholders(fields, campaign)
                ):
                    last_errors = [
                        "Email aligned to built-in placeholder copy — retry LLM"
                    ]
                    continue
            if self.channel == "email" and design.get("sections"):
                if validate_email_structure is not None:
                    ok_struct, struct_errs = validate_email_structure(fields, design)
                    if not ok_struct:
                        last_errors = struct_errs
                        continue
            if (
                self.channel == "whatsapp"
                and design.get("meta_layout")
                and validate_whatsapp_layout is not None
            ):
                ok_layout, layout_errs = validate_whatsapp_layout(fields, design)
                if not ok_layout:
                    last_errors = layout_errs
                    continue
            if fields_are_usable(self.channel, fields):
                if self.channel == "email" and design:
                    fields.setdefault(
                        "pattern_id", str(design.get("pattern_id") or "")
                    )
                    fields.setdefault("theme_id", str(design.get("theme_id") or ""))
                    if isinstance(design.get("theme"), dict) and not fields.get("theme"):
                        fields["theme"] = dict(design["theme"])
                if self.channel == "email":
                    fields = _ensure_email_subject(fields)
                return fields
            last_errors = list(last_errors) + [
                f"{self.channel} fields failed usability checks"
            ]
        # Email safety net: never leave the user with zero cards when a design
        # plan exists — synthesize from plan + campaign after LLM empties.
        if (
            self.channel == "email"
            and isinstance(design, dict)
            and design.get("sections")
            and align_email_fields_to_design_plan is not None
        ):
            _log.warning(
                "%s falling back to design-plan fields after LLM failures: %s",
                self.channel,
                "; ".join(list(dict.fromkeys(last_errors))[:4]) or "empty JSON",
            )
            fallback = normalize_fields(
                self.channel,
                align_email_fields_to_design_plan(
                    last_fields or {},
                    design,
                    campaign=campaign,
                    force=True,
                ),
            )
            if design.get("pattern_id"):
                fallback.setdefault("pattern_id", str(design.get("pattern_id") or ""))
            if design.get("theme_id"):
                fallback.setdefault("theme_id", str(design.get("theme_id") or ""))
            if isinstance(design.get("theme"), dict) and not fallback.get("theme"):
                fallback["theme"] = dict(design["theme"])
            fallback = _ensure_email_subject(fallback)
            if fields_are_usable(self.channel, fallback) or fallback.get("sections"):
                return fallback
        reason = "; ".join(list(dict.fromkeys(last_errors))[:6]) or "unknown"
        _log.warning(
            "%s agent failed to generate usable fields after retries: %s",
            self.channel,
            reason,
        )
        raise RuntimeError(
            f"{self.channel} agent failed to generate usable fields: {reason}"
        )
    async def edit(
        self,
        current_fields: dict[str, Any],
        instruction: str,
        campaign: dict[str, Any],
        recent_messages: list[dict[str, Any]] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        from app.agents.template_library.edit_tools import run_template_edit_tools

        return await run_template_edit_tools(
            channel=self.channel,
            current_fields=current_fields,
            instruction=instruction,
            campaign=campaign,
            recent_messages=recent_messages,
            **kwargs,
        )

    async def _llm_fields(self, user_prompt: str) -> dict[str, Any] | None:
        data = await self._llm_json(user_prompt)
        if not data:
            return None
        if "fields" in data and isinstance(data.get("fields"), dict):
            return normalize_fields(self.channel, data["fields"])
        return normalize_fields(self.channel, data)

    @staticmethod
    def _parse_llm_payload(result: dict[str, Any] | None) -> dict[str, Any] | None:
        """Parse JSON from content; fall back to reasoning when content is empty."""
        return parse_llm_run_result(result)

    async def _llm_json(self, user_prompt: str) -> dict[str, Any] | None:
        try:
            result = await asyncio.to_thread(
                get_llm().run,
                [
                    {
                        "role": "system",
                        "content": (
                            self.system_prompt
                            + "\n"
                            + INTERNAL_CONTEXT_RULES
                            + "\nYou must reply with a single JSON object only. "
                            "Put the full JSON in the message content field. "
                            "No Markdown fences unless needed for JSON."
                        ),
                    },
                    {"role": "user", "content": user_prompt},
                ],
                [],
                GEN_REASONING_EFFORT,
                GEN_MAX_TOKENS,
                0.3,
            )
            data = self._parse_llm_payload(result)
            if data:
                return data
            empty = not str(result.get("content") or "").strip()
            finish = str(result.get("finish_reason") or "")
            # Compact retry: less prompt noise + thinking forced off + lower temp.
            compact_user = user_prompt
            if len(compact_user) > 6000:
                compact_user = compact_user[:6000] + "\n…(truncated)…\nReturn ONLY the JSON object."
            retry = await asyncio.to_thread(
                get_llm().run,
                [
                    {
                        "role": "system",
                        "content": (
                            "Return only one JSON object in the message content field. "
                            "Do not use reasoning. Do not wrap in markdown."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            compact_user
                            + (
                                "\n\nCRITICAL: previous reply had EMPTY content"
                                + (
                                    f" (finish_reason={finish})."
                                    if finish
                                    else "."
                                )
                                + " Put the complete JSON in content now."
                                if empty
                                else "\n\nPrevious reply was not valid JSON. "
                                "Respond with a complete JSON object in content only."
                            )
                        ),
                    },
                ],
                [],
                "low",
                GEN_MAX_TOKENS,
                0.1,
            )
            data = self._parse_llm_payload(retry)
            if data:
                return data
            # Last chance: still empty after thinking-off — try once more with
            # a minimal schema-only ask so the model cannot stall in reasoning.
            if empty or not str(retry.get("content") or "").strip():
                minimal = await asyncio.to_thread(
                    get_llm().run,
                    [
                        {
                            "role": "system",
                            "content": "Output one JSON object only. No prose.",
                        },
                        {
                            "role": "user",
                            "content": (
                                f"Channel={self.channel}. "
                                "Produce complete template fields JSON now.\n\n"
                                + compact_user[-3500:]
                            ),
                        },
                    ],
                    [],
                    "low",
                    GEN_MAX_TOKENS,
                    0.15,
                )
                return self._parse_llm_payload(minimal)
            return None
        except Exception:  # noqa: BLE001
            return None