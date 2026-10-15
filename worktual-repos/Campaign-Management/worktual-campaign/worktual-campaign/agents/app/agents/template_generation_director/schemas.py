"""Typed-normalization helpers for Director layer contracts."""

from __future__ import annotations

from typing import Any

from app.agents.template_generation_director.patterns import (
    EMAIL_PATTERNS,
    EMAIL_THEMES,
    WHATSAPP_PRESETS,
)


def _text(value: Any, fallback: str = "") -> str:
    value = str(value or "").strip()
    return value or fallback


def _flag_true(value: Any) -> bool:
    if value is True:
        return True
    if value is False or value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes"}


def normalize_creative_brief(raw: Any, campaign: dict[str, Any]) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    tone = data.get("tone") if isinstance(data.get("tone"), list) else []
    return {
        "narrative": _text(data.get("narrative"), ""),
        "core_idea": _text(
            data.get("core_idea"),
            _text(campaign.get("objective"), _text(campaign.get("goal"), "Customer update")),
        ),
        "campaign_intent": _text(data.get("campaign_intent"), "announcement").lower(),
        "funnel_stage": _text(data.get("funnel_stage"), "consideration").lower(),
        "audience_state": _text(data.get("audience_state"), "relevant audience"),
        "primary_message": _text(
            data.get("primary_message"), _text(campaign.get("objective"), "Explain the value")
        ),
        "desired_action": _text(data.get("desired_action"), "learn_more").lower(),
        "tone": [_text(v) for v in tone if _text(v)][:4] or ["clear", "helpful"],
        "must_include": [
            _text(v) for v in data.get("must_include", []) if _text(v)
        ][:8]
        if isinstance(data.get("must_include"), list)
        else [],
        "must_avoid": [
            _text(v) for v in data.get("must_avoid", []) if _text(v)
        ][:8]
        if isinstance(data.get("must_avoid"), list)
        else ["unsupported claims"],
        "verified_facts": [
            _text(v) for v in data.get("verified_facts", []) if _text(v)
        ][:12]
        if isinstance(data.get("verified_facts"), list)
        else [],
        "missing_facts": [
            _text(v) for v in data.get("missing_facts", []) if _text(v)
        ][:8]
        if isinstance(data.get("missing_facts"), list)
        else [],
        "visual_design_intent": _text(data.get("visual_design_intent"), ""),
    }


def normalize_design_plan(
    channel: str,
    raw: Any,
    *,
    prior_pattern_ids: set[str] | None = None,
    wants_images: bool = False,
) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    prior = prior_pattern_ids or set()
    if channel == "email":
        from app.agents.image.hero_image import ensure_image_section_in_plan

        pattern = _text(data.get("pattern_id") or data.get("archetype")).lower()
        if pattern not in EMAIL_PATTERNS or (pattern in prior and len(EMAIL_PATTERNS) > 1):
            pattern = next((p for p in EMAIL_PATTERNS if p not in prior), "editorial")
        theme_id = _text(data.get("theme_id")).lower()
        if theme_id not in EMAIL_THEMES:
            theme_id = "clean_light"
        spec = EMAIL_PATTERNS[pattern]
        requested = data.get("sections")
        sections = (
            [_text(v).lower() for v in requested if _text(v)]
            if isinstance(requested, list)
            else list(spec["sections"])
        )
        allowed = {
            "headline", "text", "benefits", "product", "offer", "testimonial",
            "statistics", "event_details", "comparison", "proof", "divider",
            "cta", "secondary_link", "signoff", "social_links", "compliance_footer", "image",
        }
        sections = [s for s in sections if s in allowed]
        if "headline" not in sections:
            sections.insert(0, "headline")
        if not sections:
            sections = list(spec["sections"])
        cta_strategy_raw = (
            data.get("cta_strategy")
            if isinstance(data.get("cta_strategy"), dict)
            else {}
        )
        if cta_strategy_raw and not _flag_true(cta_strategy_raw.get("required")):
            sections = [s for s in sections if s not in {"cta", "secondary_link"}]
        from app.agents.image.hero_image import normalize_image_slot_specs
        from app.agents.template_library.email_brand import (
            extract_brand_from_context,
            merge_brand_into_theme,
            normalize_footer_links,
            normalize_social_links,
            normalize_theme_dict,
        )

        slot_specs = normalize_image_slot_specs(data.get("image_slot_specs"))
        slot_count = len(slot_specs) if slot_specs else (1 if wants_images else 0)
        sections = ensure_image_section_in_plan(
            sections,
            wants_images=wants_images,
            image_slot_count=slot_count,
        )
        if wants_images and not slot_specs:
            slot_specs = [
                {
                    "role": "hero",
                    "aspect_ratio": "16:9",
                    "display": "full_width",
                    "subject_hint": "",
                }
                for _ in range(min(6, max(1, sections.count("image"))))
            ]
        brand = extract_brand_from_context(
            company_pack=data.get("_company_pack")
            if isinstance(data.get("_company_pack"), dict)
            else None,
            campaign=data.get("_campaign")
            if isinstance(data.get("_campaign"), dict)
            else None,
            design_plan=data,
        )
        theme_overrides = normalize_theme_dict(
            data.get("theme_overrides")
            if isinstance(data.get("theme_overrides"), dict)
            else {}
        )
        theme_dict = merge_brand_into_theme(
            dict(EMAIL_THEMES[theme_id]),
            brand,
            overrides=theme_overrides or None,
        )
        socials = normalize_social_links(
            data.get("social_links") or brand.get("social_links")
        )
        footers = normalize_footer_links(
            data.get("footer_links") or brand.get("footer_links")
        )
        if socials and "social_links" not in sections:
            insert_at = len(sections)
            if "compliance_footer" in sections:
                insert_at = sections.index("compliance_footer")
            sections.insert(insert_at, "social_links")
        return {
            "channel": "email",
            "archetype": pattern,
            "pattern_id": pattern,
            "theme_id": theme_id,
            "theme": theme_dict,
            "brand": brand,
            "social_links": socials,
            "footer_links": footers,
            "sections": sections[:14],
            "image_slot_specs": slot_specs,
            "visual_direction": _text(data.get("visual_direction"), spec["direction"]),
            "content_rhythm": _text(data.get("content_rhythm"), "scannable and purposeful"),
            "cta_strategy": cta_strategy_raw
            or {"required": False, "position": "as planned"},
        }
    if channel == "whatsapp":
        preset = _text(data.get("preset_id") or data.get("archetype")).lower()
        if preset not in WHATSAPP_PRESETS or (preset in prior and len(WHATSAPP_PRESETS) > 1):
            preset = next((p for p in WHATSAPP_PRESETS if p not in prior), "wa_header_hook")
        media_url = _text(data.get("header_media_url") or data.get("media_url"))
        media_handle = _text(data.get("header_media_handle") or data.get("media_handle"))
        if preset == "wa_image_header" and not media_handle:
            preset = "wa_header_hook"
            media_url = ""
        spec = WHATSAPP_PRESETS[preset]
        out = {
            "channel": "whatsapp",
            "archetype": preset,
            "preset_id": preset,
            "meta_layout": spec,
            "visual_direction": spec["description"],
        }
        if media_url:
            out["header_media_url"] = media_url
        if media_handle:
            out["header_media_handle"] = media_handle
        return out
    archetype = _text(data.get("archetype"), f"{channel}_native").lower()
    return {
        "channel": channel,
        "archetype": archetype,
        "content_flow": data.get("content_flow")
        if isinstance(data.get("content_flow"), list)
        else ["hook", "benefit", "next_step"],
        "tone": _text(data.get("tone"), "clear and channel-native"),
    }


def _paragraph_pool(fields: dict[str, Any]) -> list[str]:
    """Collect flat body copy for section synthesis."""
    out: list[str] = []
    seen: set[str] = set()
    for key in ("greeting", "preheader"):
        text = _text(fields.get(key))
        if text and text.lower() not in seen:
            out.append(text)
            seen.add(text.lower())
    paragraphs = fields.get("paragraphs")
    if isinstance(paragraphs, list):
        for raw in paragraphs:
            text = _text(raw)
            if text and text.lower() not in seen:
                out.append(text)
                seen.add(text.lower())
    sections = fields.get("sections")
    if isinstance(sections, list):
        for row in sections:
            if not isinstance(row, dict):
                continue
            for key in ("content", "text"):
                text = _text(row.get(key))
                if text and text.lower() not in seen:
                    out.append(text)
                    seen.add(text.lower())
            items = row.get("items")
            if isinstance(items, list):
                for raw in items:
                    text = _text(raw)
                    if text and text.lower() not in seen:
                        out.append(text)
                        seen.add(text.lower())
    return out


def _section_pool(sections: list[Any]) -> dict[str, list[dict[str, Any]]]:
    pool: dict[str, list[dict[str, Any]]] = {}
    for row in sections:
        if not isinstance(row, dict):
            continue
        kind = _text(row.get("type")).lower()
        if not kind:
            continue
        pool.setdefault(kind, []).append(dict(row))
    return pool


def _take_section(pool: dict[str, list[dict[str, Any]]], kind: str) -> dict[str, Any] | None:
    rows = pool.get(kind) or []
    if rows:
        return rows.pop(0)
    return None


_OPTIONAL_ACTION_TYPES = frozenset({"cta", "secondary_link"})


def _agent_wants_cta(data: dict[str, Any], pool: dict[str, list[dict[str, Any]]]) -> bool:
    if pool.get("cta"):
        return True
    return bool(_text(data.get("cta_label")) or _text(data.get("cta_url")))


def _agent_wants_secondary(pool: dict[str, list[dict[str, Any]]]) -> bool:
    return bool(pool.get("secondary_link"))


def _insert_action_slot(expected: list[str], kind: str) -> list[str]:
    if kind in expected:
        return expected
    out = list(expected)
    if "compliance_footer" in out:
        out.insert(out.index("compliance_footer"), kind)
    else:
        out.append(kind)
    return out


def _apply_optional_actions(
    expected: list[str],
    *,
    data: dict[str, Any],
    pool: dict[str, list[dict[str, Any]]],
) -> list[str]:
    """Keep agent-emitted CTAs; drop planned CTAs the agent did not emit."""
    wants_cta = _agent_wants_cta(data, pool)
    wants_sec = _agent_wants_secondary(pool)
    out = list(expected)
    if wants_cta:
        out = _insert_action_slot(out, "cta")
    else:
        out = [k for k in out if k != "cta"]
    if wants_sec:
        out = _insert_action_slot(out, "secondary_link")
    else:
        out = [k for k in out if k != "secondary_link"]
    return out


def email_fields_contain_builtin_placeholders(
    fields: dict[str, Any] | None,
    campaign: dict[str, Any] | None = None,
) -> bool:
    """True when email copy matches deterministic safety filler (not real LLM copy)."""
    data = fields if isinstance(fields, dict) else {}
    camp = campaign if isinstance(campaign, dict) else {}
    fb = _customer_facing_fallbacks(camp)
    body = str(fb["body"])
    benefits = {str(x) for x in fb["benefits"]}
    for row in data.get("sections") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("content") or "") == body:
            return True
        for item in row.get("items") or []:
            if str(item) in benefits:
                return True
    return False


def _customer_facing_fallbacks(campaign: dict[str, Any]) -> dict[str, str | list[str]]:
    """Neutral marketing placeholders — never paste internal goal/objective strings."""
    name = _text(campaign.get("name"))
    headline = name[:120] if name else "An offer made for you"
    return {
        "subject": headline[:100] or "An update for you",
        "headline": headline,
        "body": "Here's what matters for you — and a clear next step when you're ready.",
        "benefits": [
            "A benefit that speaks to your needs",
            "Straightforward value without the jargon",
            "A simple next step when you're ready",
        ],
        "offer": "A limited-time opportunity tailored for you.",
    }


def _synthesize_email_section(
    kind: str,
    *,
    para_pool: list[str],
    subject: str,
    cta_label: str,
    cta_url: str,
    signoff: str,
    footer: str,
    campaign: dict[str, Any],
) -> dict[str, Any] | None:
    def next_para(fallback: str = "") -> str:
        if para_pool:
            return para_pool.pop(0)
        return fallback

    safe = _customer_facing_fallbacks(campaign)
    default_body = str(safe["body"])
    # Internal goal/objective are INPUT to writers only — never paste into template slots.

    if kind == "headline":
        content = next_para(subject) or subject or str(safe["headline"])
        return {"type": "headline", "purpose": "hook", "content": content[:160]}
    if kind == "text":
        return {
            "type": "text",
            "purpose": "context",
            "content": next_para(default_body),
        }
    if kind == "benefits":
        items: list[str] = []
        for _ in range(3):
            line = next_para("")
            if line:
                items.append(line)
        if len(items) < 2:
            items.extend([str(x) for x in safe["benefits"] if str(x).strip()])
        items = list(dict.fromkeys(items))[:4]
        if len(items) < 2:
            items = [default_body, "Clear value tailored for you"]
        return {"type": "benefits", "purpose": "value", "items": items[:4]}
    if kind == "cta":
        if not cta_url:
            return None
        return {
            "type": "cta",
            "purpose": "action",
            "label": cta_label,
            "url": cta_url,
        }
    if kind == "secondary_link":
        if not cta_url:
            return None
        return {
            "type": "secondary_link",
            "purpose": "alt_action",
            "label": cta_label or "View details",
            "url": cta_url,
        }
    if kind == "signoff":
        return {"type": "signoff", "purpose": "close", "content": signoff}
    if kind == "social_links":
        return {
            "type": "social_links",
            "purpose": "brand_links",
            "links": [],
            "items": [],
        }
    if kind == "compliance_footer":
        return {"type": "compliance_footer", "purpose": "footer", "content": footer}
    if kind == "image":
        return {"type": "image", "purpose": "hero", "content": "[Hero image]"}
    if kind == "divider":
        return {"type": "divider"}
    if kind == "product":
        return {
            "type": "product",
            "purpose": "spotlight",
            "content": next_para("Explore the offer built for you."),
        }
    if kind == "offer":
        return {
            "type": "offer",
            "purpose": "promo",
            "content": next_para(str(safe["offer"])),
        }
    if kind == "testimonial":
        return {
            "type": "testimonial",
            "purpose": "proof",
            "content": next_para("Customers are seeing real results."),
        }
    if kind == "event_details":
        return {
            "type": "event_details",
            "purpose": "logistics",
            "content": next_para("Join us for this special occasion."),
        }
    if kind == "comparison":
        return {
            "type": "comparison",
            "purpose": "decide",
            "content": next_para("See how the upgrade compares."),
        }
    if kind == "proof":
        return {
            "type": "proof",
            "purpose": "trust",
            "content": next_para("Trusted by customers like you."),
        }
    if kind == "statistics":
        return {
            "type": "statistics",
            "purpose": "metrics",
            "content": next_para("Results that matter."),
        }
    return {"type": kind, "content": next_para(default_body)}


def align_email_fields_to_design_plan(
    fields: dict[str, Any],
    design_plan: dict[str, Any],
    *,
    campaign: dict[str, Any] | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Map LLM email output onto the Director section contract.

    Reorders sections to match the plan, converts legacy paragraph bodies when
    needed, and fills missing slots from available copy so validation does not
    fail on ordering alone.
    """
    data = dict(fields or {})
    plan = design_plan if isinstance(design_plan, dict) else {}
    expected = [
        str(value).strip().lower()
        for value in plan.get("sections", [])
        if str(value).strip()
    ] if isinstance(plan.get("sections"), list) else []
    if not expected:
        return data

    camp = campaign if isinstance(campaign, dict) else {}
    existing = data.get("sections") if isinstance(data.get("sections"), list) else []
    pool = _section_pool(existing)
    expected = _apply_optional_actions(expected, data=data, pool=pool)
    cta_label = _text(data.get("cta_label"))
    cta_url = _text(data.get("cta_url") or camp.get("form_url") or camp.get("cta_url") or camp.get("destination_url"))
    if cta_url and "{{" in cta_url:
        cta_url = ""
    if not cta_label and pool.get("cta"):
        cta_label = _text(pool["cta"][0].get("label"))
    subject = _text(data.get("subject"))
    signoff = _text(data.get("signoff"), "Warm regards,")
    footer = _text(
        data.get("footer"),
        "You are receiving this email because you opted in. Unsubscribe anytime.",
    )
    para_pool = _paragraph_pool(data)
    has_source = bool(
        force
        or subject
        or para_pool
        or existing
        or _text(camp.get("objective"))
        or _text(camp.get("goal"))
    )

    aligned: list[dict[str, Any]] = []
    for kind in expected:
        row = _take_section(pool, kind)
        if row is None:
            if has_source:
                row = _synthesize_email_section(
                    kind,
                    para_pool=para_pool,
                    subject=subject,
                    cta_label=cta_label,
                    cta_url=cta_url,
                    signoff=signoff,
                    footer=footer,
                    campaign=camp,
                )
            else:
                continue
        if not isinstance(row, dict):
            continue
        aligned.append({**row, "type": kind})

    specs = plan.get("image_slot_specs") if isinstance(plan.get("image_slot_specs"), list) else []
    spec_i = 0
    for row in aligned:
        if str(row.get("type") or "").lower() != "image":
            continue
        if spec_i < len(specs) and isinstance(specs[spec_i], dict):
            spec = specs[spec_i]
            if spec.get("role"):
                row["purpose"] = str(spec.get("role"))
            if spec.get("display"):
                row["display"] = str(spec.get("display"))
            if spec.get("aspect_ratio"):
                row["aspect_ratio"] = str(spec.get("aspect_ratio"))
        spec_i += 1

    if not aligned:
        return data

    if not subject:
        headline = next(
            (
                _text(row.get("content"))
                for row in aligned
                if _text(row.get("type")).lower() == "headline"
            ),
            "",
        )
        # Never fall back to internal goal/objective — those are writer inputs only.
        safe = _customer_facing_fallbacks(camp)
        subject = headline or str(safe["subject"])
        subject = subject[:120] or "An update for you"

    out = {
        **data,
        "sections": aligned,
        "subject": subject,
        "pattern_id": _text(plan.get("pattern_id"), _text(data.get("pattern_id"))),
        "theme_id": _text(plan.get("theme_id"), _text(data.get("theme_id"))),
        "greeting": "",
        "paragraphs": [],
        "body": "",
        "signoff": "",
        "footer": "",
    }
    if isinstance(plan.get("theme"), dict) and plan.get("theme"):
        out["theme"] = dict(plan["theme"])
    from app.agents.template_library.email_brand import apply_brand_to_email_fields

    brand = plan.get("brand") if isinstance(plan.get("brand"), dict) else {}
    socials = plan.get("social_links") if isinstance(plan.get("social_links"), list) else []
    footers = plan.get("footer_links") if isinstance(plan.get("footer_links"), list) else []
    if socials:
        out["social_links"] = socials
        for row in out.get("sections") or []:
            if isinstance(row, dict) and str(row.get("type") or "").lower() == "social_links":
                row["links"] = socials
                row["items"] = [
                    f"{s.get('label')}|{s.get('url')}"
                    for s in socials
                    if isinstance(s, dict)
                ]
                break
    if footers:
        out["footer_links"] = footers
    if brand or socials or footers or out.get("theme"):
        out = apply_brand_to_email_fields(
            out,
            {
                **brand,
                "social_links": socials or brand.get("social_links"),
                "footer_links": footers or brand.get("footer_links"),
            },
        )
    return out


def validate_email_structure(
    fields: dict[str, Any] | None,
    design_plan: dict[str, Any] | None,
) -> tuple[bool, list[str]]:
    """Enforce the Director's semantic section contract deterministically."""
    data = fields if isinstance(fields, dict) else {}
    plan = design_plan if isinstance(design_plan, dict) else {}
    expected = [
        str(value).strip().lower()
        for value in plan.get("sections", [])
        if str(value).strip()
    ] if isinstance(plan.get("sections"), list) else []
    actual_rows = data.get("sections") if isinstance(data.get("sections"), list) else []
    actual = [
        str(row.get("type") or "").strip().lower()
        for row in actual_rows
        if isinstance(row, dict) and str(row.get("type") or "").strip()
    ]
    comparable = [
        kind
        for kind in expected
        if kind not in _OPTIONAL_ACTION_TYPES or kind in actual
    ]
    errors: list[str] = []
    if comparable and actual != comparable:
        errors.append(
            "Email sections must match the selected design plan in this exact order: "
            + ", ".join(comparable)
            + "."
        )
    planned_pattern = str(plan.get("pattern_id") or "").strip().lower()
    returned_pattern = str(data.get("pattern_id") or "").strip().lower()
    if planned_pattern and returned_pattern and returned_pattern != planned_pattern:
        errors.append(f"Email pattern_id must remain {planned_pattern}.")
    return (not errors, errors)

