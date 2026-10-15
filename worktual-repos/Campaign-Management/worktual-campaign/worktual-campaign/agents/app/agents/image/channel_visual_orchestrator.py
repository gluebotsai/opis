"""Deterministic per-channel image intent for template generation.

The LLM sets explicit tool arguments (channel_visuals, wants_images, image_mode,
plan_campaign_images mode/channels). This module merges those inputs and produces
per-channel image slices for create_payload — no chat parsing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.agents.image.channel_image import channel_supports_image, normalize_channel_list
from app.agents.image.enhance import normalize_channel
from app.agents.image.hero_image import fields_have_hero_image, select_primary_hero_url
from app.agents.image.plan import get_image_plan, set_image_plan
from app.agents.image.user_assets import preferred_urls_by_channel

# Tool-facing visual intents (LLM passes these on build_campaign.channel_visuals).
VISUAL_NONE = "none"
VISUAL_KEEP = "keep"
VISUAL_GENERATE = "generate"
VISUAL_USE_UPLOAD = "use_upload"
VISUAL_SHARED = "shared"
VISUAL_INHERIT_EMAIL_PRIMARY = "inherit_email_primary"

_ALLOWED_VISUAL = frozenset(
    {
        VISUAL_NONE,
        VISUAL_KEEP,
        VISUAL_GENERATE,
        VISUAL_USE_UPLOAD,
        VISUAL_SHARED,
        VISUAL_INHERIT_EMAIL_PRIMARY,
    }
)


@dataclass
class ResolvedChannelVisual:
    channel: str
    visual: str
    image_slice: dict[str, Any] | None = None


@dataclass
class VisualResolution:
    """Output of merge — consumed by build_create_payload and image batch."""

    channels: list[str] = field(default_factory=list)
    by_channel: dict[str, ResolvedChannelVisual] = field(default_factory=dict)
    wants_images: bool = False
    plan_mode: str = "shared"
    generate_channels: list[str] = field(default_factory=list)
    ready_urls: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def _normalize_visual(raw: Any) -> str:
    key = str(raw or "").strip().lower().replace("-", "_")
    aliases = {
        "no_image": VISUAL_NONE,
        "no": VISUAL_NONE,
        "off": VISUAL_NONE,
        "plan_new": VISUAL_GENERATE,
        "new": VISUAL_GENERATE,
        "ai": VISUAL_GENERATE,
        "upload": VISUAL_USE_UPLOAD,
        "use_shared": VISUAL_SHARED,
        "shared_generate": VISUAL_SHARED,
        "inherit_email": VISUAL_INHERIT_EMAIL_PRIMARY,
        "email_primary": VISUAL_INHERIT_EMAIL_PRIMARY,
        "reuse_prior": VISUAL_KEEP,
        "keep_prior": VISUAL_KEEP,
    }
    key = aliases.get(key, key)
    return key if key in _ALLOWED_VISUAL else ""


def _parse_channel_visuals(args: dict[str, Any]) -> dict[str, str]:
    """Explicit per-channel intents from build_campaign.channel_visuals."""
    out: dict[str, str] = {}
    raw = args.get("channel_visuals")
    if not isinstance(raw, list):
        return out
    for row in raw:
        if not isinstance(row, dict):
            continue
        ch = normalize_channel(str(row.get("channel") or ""))
        vis = _normalize_visual(row.get("visual") or row.get("image_visual"))
        if ch and vis:
            out[ch] = vis
    return out


def _prior_fields_for_channel(session: dict[str, Any], channel: str) -> dict[str, Any]:
    ch = normalize_channel(channel)
    for row in reversed(session.get("templates") or []):
        if not isinstance(row, dict):
            continue
        if normalize_channel(str(row.get("channel") or "")) != ch:
            continue
        fields = row.get("fields")
        if isinstance(fields, dict):
            return fields
    return {}


def _url_from_prior(session: dict[str, Any], channel: str) -> str:
    fields = _prior_fields_for_channel(session, channel)
    if not fields:
        return ""
    return select_primary_hero_url(fields)


def merge_channel_visuals(
    session: dict[str, Any],
    *,
    channels: list[str],
    args: dict[str, Any] | None = None,
) -> VisualResolution:
    """Merge LLM tool args + saved image plan into a per-channel resolution."""
    args = args if isinstance(args, dict) else {}
    selected = [
        normalize_channel(c)
        for c in normalize_channel_list(channels)
        if normalize_channel(c)
    ]
    explicit = _parse_channel_visuals(args)
    plan = get_image_plan(session)
    plan_channels = {
        normalize_channel(str(c))
        for c in (plan.get("channels") or [])
        if str(c).strip()
    }
    plan_mode = str(plan.get("mode") or "shared").strip().lower()
    if plan_mode not in ("shared", "per_channel"):
        plan_mode = "shared"

    wants_flag = args.get("wants_images")
    if wants_flag is None:
        wants_flag = plan.get("wants_images")
    wants_images = bool(wants_flag)

    image_mode = str(args.get("image_mode") or "").strip().lower()
    if not image_mode:
        policy = args.get("creative_policy")
        if isinstance(policy, dict):
            image_mode = str(policy.get("image_mode") or "").strip().lower()

    preferred = preferred_urls_by_channel(session, channels=selected)

    resolution = VisualResolution(channels=selected, plan_mode=plan_mode)

    for ch in selected:
        vis = explicit.get(ch, "")
        if not vis:
            if image_mode == "none":
                vis = VISUAL_NONE
            elif ch in preferred and image_mode != "none":
                # Confirmed upload overrides turn-level keep on regen unless LLM said keep.
                vis = VISUAL_USE_UPLOAD
            elif image_mode == "keep":
                vis = VISUAL_KEEP
            elif image_mode == "plan_new":
                vis = VISUAL_SHARED if plan_mode == "shared" else VISUAL_GENERATE
            elif not wants_images:
                vis = VISUAL_NONE
            elif plan_channels and ch not in plan_channels:
                vis = VISUAL_NONE
            elif ch in preferred:
                vis = VISUAL_USE_UPLOAD
            elif plan_mode == "shared":
                vis = VISUAL_SHARED
            else:
                vis = VISUAL_GENERATE

        if not channel_supports_image(ch):
            vis = VISUAL_NONE

        if vis == VISUAL_INHERIT_EMAIL_PRIMARY and ch == "email":
            vis = VISUAL_GENERATE

        slice_row: dict[str, Any] | None = None
        ready_url = ""

        if vis == VISUAL_NONE:
            slice_row = None
        elif vis == VISUAL_KEEP:
            ready_url = _url_from_prior(session, ch)
            if ready_url:
                slice_row = {
                    "mode": "ready",
                    "image_url": ready_url,
                    "source": "prior_template",
                }
            else:
                resolution.notes.append(f"{ch}: keep requested but no prior hero URL")
                slice_row = None
        elif vis == VISUAL_USE_UPLOAD:
            ready_url = preferred.get(ch, "")
            if ready_url:
                slice_row = {
                    "mode": "ready",
                    "image_url": ready_url,
                    "source": "upload_or_gallery",
                }
            else:
                resolution.notes.append(f"{ch}: use_upload but no URL on file")
                slice_row = None
        elif vis == VISUAL_INHERIT_EMAIL_PRIMARY:
            email_fields = _prior_fields_for_channel(session, "email")
            ready_url = select_primary_hero_url(email_fields) if email_fields else ""
            if ready_url:
                slice_row = {
                    "mode": "ready",
                    "image_url": ready_url,
                    "source": "inherit_email_primary",
                }
            else:
                slice_row = {
                    "mode": "inherit_email_primary",
                    "source": "pending_email_compose",
                }
        elif vis in (VISUAL_GENERATE, VISUAL_SHARED):
            slice_row = {
                "mode": "generate",
                "source": "ai_generate",
                "visual": vis,
            }
        else:
            slice_row = None

        resolution.by_channel[ch] = ResolvedChannelVisual(
            channel=ch, visual=vis, image_slice=slice_row
        )
        if slice_row and str(slice_row.get("mode") or "") == "ready":
            url = str(slice_row.get("image_url") or "").strip()
            if url:
                resolution.ready_urls[ch] = url

    # Shared generate: one primary channel runs Gemini; others wait for apply_ready.
    shared_members = [
        ch
        for ch, row in resolution.by_channel.items()
        if row.visual in (VISUAL_SHARED, VISUAL_GENERATE)
        or (
            isinstance(row.image_slice, dict)
            and row.image_slice.get("mode") == "generate"
            and row.image_slice.get("visual") == VISUAL_SHARED
        )
    ]
    per_channel_gen = [
        ch
        for ch, row in resolution.by_channel.items()
        if row.visual == VISUAL_GENERATE
        or (
            isinstance(row.image_slice, dict)
            and row.image_slice.get("mode") == "generate"
            and row.image_slice.get("visual") != VISUAL_SHARED
        )
    ]

    if plan_mode == "shared" and shared_members:
        resolution.generate_channels = list(shared_members)
    else:
        resolution.generate_channels = list(
            dict.fromkeys(shared_members + per_channel_gen)
        )

    resolution.wants_images = any(
        row.image_slice is not None for row in resolution.by_channel.values()
    ) or bool(resolution.generate_channels)

    # Sync session plan for downstream batch attach (tool-normalized only).
    if resolution.wants_images:
        plan_chs = [
            ch
            for ch, row in resolution.by_channel.items()
            if row.image_slice is not None
        ]
        set_image_plan(
            session,
            wants_images=True,
            channels=plan_chs or selected,
            mode=plan_mode,
            scope="subset",
            auto_after_build=True,
            user_confirmed=bool(args.get("user_confirmed")),
        )

    return resolution


def apply_inherit_from_email_templates(
    payload: dict[str, Any],
    email_templates: list[dict[str, Any]],
) -> dict[str, Any]:
    """After email compose, fill inherit_email_primary slices from email fields."""
    if not email_templates:
        return payload
    email_fields: dict[str, Any] = {}
    for row in email_templates:
        if not isinstance(row, dict):
            continue
        if normalize_channel(str(row.get("channel") or "")) != "email":
            continue
        fields = row.get("fields")
        if isinstance(fields, dict):
            email_fields = fields
            break
    if not email_fields:
        return payload

    hero = select_primary_hero_url(email_fields)
    if not hero:
        return payload

    channels: list[dict[str, Any]] = []
    for row in payload.get("channels") or []:
        if not isinstance(row, dict):
            continue
        out = dict(row)
        ch = normalize_channel(str(out.get("channel") or ""))
        image = out.get("image") if isinstance(out.get("image"), dict) else {}
        mode = str(image.get("mode") or "")
        if mode == "inherit_email_primary":
            out["image"] = {
                "mode": "ready",
                "image_url": hero,
                "source": "inherit_email_primary",
            }
        channels.append(out)
    return {**payload, "channels": channels}


def channel_assets_summary(
    templates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Per-channel facts for build_campaign tool results (ground LLM replies)."""
    out: list[dict[str, Any]] = []
    for row in templates or []:
        if not isinstance(row, dict):
            continue
        ch = normalize_channel(str(row.get("channel") or ""))
        tid = str(row.get("template_id") or "").strip()
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        has_image = fields_have_hero_image(fields) if fields else False
        url = select_primary_hero_url(fields) if fields else ""
        image_source = None
        if isinstance(fields, dict):
            meta = fields.get("_hero_source") or fields.get("hero_source")
            if meta:
                image_source = str(meta).strip()[:64]
        out.append(
            {
                "channel": ch,
                "template_id": tid or None,
                "has_image": has_image,
                "image_url": url[:500] if url else None,
                "image_source": image_source,
            }
        )
    return out


__all__ = [
    "VISUAL_NONE",
    "VISUAL_KEEP",
    "VISUAL_GENERATE",
    "VISUAL_USE_UPLOAD",
    "VISUAL_SHARED",
    "VISUAL_INHERIT_EMAIL_PRIMARY",
    "ResolvedChannelVisual",
    "VisualResolution",
    "apply_inherit_from_email_templates",
    "channel_assets_summary",
    "merge_channel_visuals",
]
