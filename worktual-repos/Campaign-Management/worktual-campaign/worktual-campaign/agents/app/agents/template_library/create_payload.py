"""Canonical create-template payload: common campaign + per-channel slices.

Agents consume only required fields for each channel. Images are resolved to
ready URLs (upload or pre-generated) before content agents run.
"""

from __future__ import annotations

from typing import Any

from app.agents.create_campaign.memory_note import get_memory_note
from app.agents.create_campaign.meta_helpers import chat_summary_from_session
from app.agents.image.channel_image import (
    channel_supports_image,
    normalize_channel_list,
)
from app.agents.image.enhance import normalize_channel
from app.agents.image.plan import get_image_plan
from app.agents.image.user_assets import (
    list_confirmed_chat_images,
    preferred_urls_by_channel,
)


# Placeholder until org compliance packs are wired automatically.
COMPLIANCE_PLACEHOLDER: dict[str, Any] = {
    "status": "placeholder",
    "rules": [],
    "notes": "Compliance guidelines will be injected automatically later.",
}


def _campaign_common(session: dict[str, Any], campaign: dict[str, Any]) -> dict[str, Any]:
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    profile = (
        session.get("campaign_profile")
        if isinstance(session.get("campaign_profile"), dict)
        else {}
    )
    return {
        "name": str(campaign.get("name") or "").strip(),
        "goal": str(campaign.get("goal") or "").strip(),
        "objective": str(campaign.get("objective") or "").strip(),
        "mode": str(campaign.get("mode") or profile.get("mode") or "").strip(),
        "industry": str(
            campaign.get("industry") or profile.get("industry_type") or ""
        ).strip(),
        "industry_type": str(
            campaign.get("industry_type") or profile.get("industry_type") or ""
        ).strip(),
        "audience_summary": str(
            aud.get("description") or aud.get("summary") or ""
        ).strip(),
        "audience": {
            "description": aud.get("description"),
            "summary": aud.get("summary"),
            "matched_count": aud.get("matched_count") or aud.get("count"),
            "filters": aud.get("filters") or {},
        },
        "memory_note": get_memory_note(session),
        "chat_summary": chat_summary_from_session(session, limit=24),
        "compliance": dict(COMPLIANCE_PLACEHOLDER),
        "campaign_profile": session.get("campaign_profile")
        if isinstance(session.get("campaign_profile"), dict)
        else {},
        "company_pack": session.get("company_pack")
        if isinstance(session.get("company_pack"), dict)
        else {},
    }


def _channel_user_note(
    session: dict[str, Any],
    channel: str,
    channel_plans: list[dict[str, Any]],
) -> str:
    """Short per-channel instruction if the user asked for something specific."""
    ch = normalize_channel(channel)
    for plan in channel_plans:
        if not isinstance(plan, dict):
            continue
        if normalize_channel(str(plan.get("channel") or "")) != ch:
            continue
        for key in (
            "user_note",
            "template_note",
            "user_request",
            "how_it_works",
            "notes",
        ):
            val = str(plan.get(key) or "").strip()
            if val and key != "how_it_works":
                return val[:800]
        # how_it_works is often a generic plan line — only keep if it looks specific.
        how = str(plan.get("how_it_works") or "").strip()
        if how and "touch for this campaign" not in how.lower():
            return how[:800]
    # Session-level per-channel notes (optional).
    notes = session.get("channel_template_notes")
    if isinstance(notes, dict):
        return str(notes.get(ch) or "").strip()[:800]
    return ""


def _image_slice_for_channel(
    session: dict[str, Any],
    channel: str,
    *,
    preferred_url: str = "",
) -> dict[str, Any] | None:
    """
    Per-channel image contract:
    - uploaded URL present → {mode: ready, image_url}
    - generate requested → {mode: generate, description} (resolved to ready later)
    - nothing about images → None (omit)
    """
    ch = normalize_channel(channel)
    if not channel_supports_image(ch):
        return None

    url = str(preferred_url or "").strip()
    if url:
        return {
            "mode": "ready",
            "image_url": url,
            "source": "upload_or_gallery",
        }

    plan = get_image_plan(session)
    wants = bool(plan.get("wants_images"))
    plan_channels = {
        normalize_channel(str(c)) for c in (plan.get("channels") or []) if str(c).strip()
    }
    if not wants or (plan_channels and ch not in plan_channels):
        return None

    # Generate requested for this channel — description from campaign brief.
    campaign = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    desc_parts = [
        str(campaign.get("name") or "").strip(),
        str(campaign.get("goal") or "").strip(),
        str(campaign.get("objective") or "").strip(),
    ]
    description = " — ".join(p for p in desc_parts if p) or f"{ch} campaign hero image"
    return {
        "mode": "generate",
        "description": description[:600],
        "source": "ai_generate",
    }


def build_create_payload(
    session: dict[str, Any],
    *,
    channels: list[str],
    campaign: dict[str, Any] | None = None,
    channel_plans: list[dict[str, Any]] | None = None,
    knowledge: str = "",
    user_request: str = "",
    tool_args: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble the single create payload used by template generation."""
    camp = campaign if isinstance(campaign, dict) else (
        session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    )
    plans = list(channel_plans or session.get("channel_plans") or [])
    selected = normalize_channel_list(channels)
    if not selected:
        selected = normalize_channel_list(session.get("channels") or [])

    from app.agents.image.channel_visual_orchestrator import merge_channel_visuals

    visual_resolution = merge_channel_visuals(
        session,
        channels=selected,
        args=tool_args if isinstance(tool_args, dict) else {},
    )

    preferred = preferred_urls_by_channel(session, channels=selected)
    # Also surface any confirmed URLs even if plan channels omitted a channel.
    for row in list_confirmed_chat_images(session):
        if not row.get("include_in_templates"):
            continue
        url = str(row.get("image_url") or "").strip()
        if not url:
            continue
        row_chs = normalize_channel_list(row.get("channels")) or selected
        for ch in row_chs:
            preferred.setdefault(normalize_channel(ch), url)

    channel_slices: list[dict[str, Any]] = []
    for ch in selected:
        plan_row = next(
            (
                p
                for p in plans
                if isinstance(p, dict)
                and normalize_channel(str(p.get("channel") or "")) == ch
            ),
            {"channel": ch},
        )
        resolved = visual_resolution.by_channel.get(ch)
        if resolved and resolved.image_slice is not None:
            image = dict(resolved.image_slice)
        else:
            image = _image_slice_for_channel(
                session, ch, preferred_url=preferred.get(ch, "")
            )
        slice_row: dict[str, Any] = {
            "channel": ch,
            "user_note": _channel_user_note(session, ch, plans),
            "how_it_works": str(plan_row.get("how_it_works") or "").strip(),
            "library_format": plan_row.get("library_format")
            if isinstance(plan_row.get("library_format"), dict)
            else None,
            "ab_test": bool(plan_row.get("ab_test") or plan_row.get("ab_enabled")),
            "suggested_launch_at": plan_row.get("suggested_launch_at"),
            "creative_policy": plan_row.get("creative_policy")
            if isinstance(plan_row.get("creative_policy"), dict)
            else None,
        }
        if image is not None:
            slice_row["image"] = image
        # Drop nulls for a clean required-only payload.
        channel_slices.append({k: v for k, v in slice_row.items() if v not in (None, "")})

    common = _campaign_common(session, camp)
    if user_request.strip():
        common["user_request"] = user_request.strip()[:1200]

    return {
        "common": common,
        "knowledge": str(knowledge or "").strip(),
        "channels": channel_slices,
        "image_mode": str(get_image_plan(session).get("mode") or "shared"),
    }


def channels_needing_image_generation(payload: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for row in payload.get("channels") or []:
        if not isinstance(row, dict):
            continue
        image = row.get("image")
        if isinstance(image, dict) and str(image.get("mode") or "") == "generate":
            ch = normalize_channel(str(row.get("channel") or ""))
            if ch:
                out.append(ch)
    return out


def channels_needing_image_generation_from_resolution(
    payload: dict[str, Any],
    *,
    plan_mode: str = "shared",
) -> list[str]:
    """When shared, one Gemini run; siblings receive the URL via fan_out_shared_image_urls."""
    need = channels_needing_image_generation(payload)
    if plan_mode != "shared" or len(need) <= 1:
        return need
    priority = ["email", "web", "push", "whatsapp"]
    for ch in priority:
        if ch in need:
            return [ch]
    return need[:1]


def channels_with_image_slices(payload: dict[str, Any]) -> list[str]:
    """Every channel row that has an image slice (ready, generate, or pending inherit)."""
    out: list[str] = []
    for row in payload.get("channels") or []:
        if not isinstance(row, dict):
            continue
        if not isinstance(row.get("image"), dict):
            continue
        ch = normalize_channel(str(row.get("channel") or ""))
        if ch:
            out.append(ch)
    return out


def fan_out_shared_image_urls(
    images_by_channel: dict[str, str],
    payload: dict[str, Any],
    *,
    plan_mode: str = "shared",
) -> dict[str, str]:
    """Copy one shared hero URL to every channel still on generate (email+web batch)."""
    merged = {
        normalize_channel(str(k)): str(v).strip()
        for k, v in (images_by_channel or {}).items()
        if normalize_channel(str(k)) and str(v).strip()
    }
    if plan_mode != "shared" or not merged:
        return merged
    shared_url = ""
    for ch in ["email", "web", "push", "whatsapp"]:
        if merged.get(ch):
            shared_url = merged[ch]
            break
    if not shared_url:
        shared_url = next(iter(merged.values()))
    for ch in channels_needing_image_generation(payload):
        merged.setdefault(ch, shared_url)
    return merged


def apply_ready_image_urls(
    payload: dict[str, Any],
    images_by_channel: dict[str, str],
) -> dict[str, Any]:
    """Replace generate slices with ready URLs after pre-generation."""
    plan_mode = str(payload.get("image_mode") or "shared").strip().lower()
    mapping = fan_out_shared_image_urls(
        images_by_channel, payload, plan_mode=plan_mode
    )
    shared_fallback = ""
    if plan_mode == "shared" and mapping:
        for ch in ["email", "web", "push", "whatsapp"]:
            if mapping.get(ch):
                shared_fallback = mapping[ch]
                break
        if not shared_fallback:
            shared_fallback = next(iter(mapping.values()), "")

    channels: list[dict[str, Any]] = []
    for row in payload.get("channels") or []:
        if not isinstance(row, dict):
            continue
        ch = normalize_channel(str(row.get("channel") or ""))
        out = dict(row)
        image = out.get("image") if isinstance(out.get("image"), dict) else {}
        mode = str(image.get("mode") or "")
        url = mapping.get(ch, "")
        if not url and shared_fallback and mode == "generate":
            url = shared_fallback
        if url:
            out["image"] = {
                "mode": "ready",
                "image_url": url,
                "source": "pre_generated_or_upload",
            }
        channels.append(out)
    return {**payload, "channels": channels}


def channel_slice(payload: dict[str, Any], channel: str) -> dict[str, Any]:
    ch = normalize_channel(channel)
    for row in payload.get("channels") or []:
        if isinstance(row, dict) and normalize_channel(str(row.get("channel") or "")) == ch:
            return dict(row)
    return {"channel": ch}


def ready_image_url(channel_row: dict[str, Any] | None) -> str:
    if not isinstance(channel_row, dict):
        return ""
    image = channel_row.get("image")
    if not isinstance(image, dict):
        return ""
    if str(image.get("mode") or "") != "ready":
        return ""
    return str(image.get("image_url") or "").strip()


__all__ = [
    "COMPLIANCE_PLACEHOLDER",
    "apply_ready_image_urls",
    "build_create_payload",
    "channel_slice",
    "channels_needing_image_generation",
    "channels_needing_image_generation_from_resolution",
    "channels_with_image_slices",
    "fan_out_shared_image_urls",
    "ready_image_url",
]
