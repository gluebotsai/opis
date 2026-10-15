"""Which channels support template images and which field keys to patch."""

from __future__ import annotations

from typing import Any

from app.agents.image.enhance import normalize_channel

# Channels whose template schema includes a visual header slot.
IMAGE_CAPABLE_CHANNELS: frozenset[str] = frozenset({"email", "whatsapp", "web"})

# Agent channel id → template field patch hints for attach.
CHANNEL_ATTACH_SPEC: dict[str, dict[str, Any]] = {
    "email": {
        "field_key": "header_image",
        "mirror_keys": ("image_url",),
    },
    "whatsapp": {
        "field_key": "header_media_url",
        "mirror_keys": ("image_url",),
        "extra_fields": {"header_format": "IMAGE"},
    },
    "web": {
        "field_key": "image_url",
        "mirror_keys": (),
    },
}


def channel_supports_image(channel: str) -> bool:
    return normalize_channel(channel) in IMAGE_CAPABLE_CHANNELS


def attach_spec_for_channel(channel: str) -> dict[str, Any] | None:
    ch = normalize_channel(channel)
    spec = CHANNEL_ATTACH_SPEC.get(ch)
    return dict(spec) if spec else None


def normalize_channel_list(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if isinstance(item, dict):
            ch = normalize_channel(str(item.get("channel") or item.get("id") or ""))
        else:
            ch = normalize_channel(str(item))
        if ch and ch not in seen:
            seen.add(ch)
            out.append(ch)
    return out


def selected_session_channels(session: dict[str, Any]) -> list[str]:
    campaign = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    raw = session.get("channels") or campaign.get("channels") or []
    return normalize_channel_list(raw)


def eligible_image_channels(session: dict[str, Any]) -> list[str]:
    """Selected channels that can receive a template image."""
    return [ch for ch in selected_session_channels(session) if channel_supports_image(ch)]


def resolve_plan_channels(
    session: dict[str, Any],
    *,
    channels: list[str] | None = None,
    scope: str = "",
) -> list[str]:
    """
    Normalize LLM-passed channel list against session selection + image capability.

    scope=all_eligible → all image-capable selected channels.
    """
    scope_norm = str(scope or "").strip().lower().replace("-", "_")
    eligible = eligible_image_channels(session)
    if scope_norm in ("all_eligible", "all", "all_channels", "all_selected"):
        return list(eligible)
    requested = normalize_channel_list(channels or [])
    if not requested:
        return list(eligible)
    allowed = set(eligible)
    return [ch for ch in requested if ch in allowed]


def template_ids_by_channel(session: dict[str, Any]) -> dict[str, str]:
    """Map channel → template_id from session index or template cards."""
    indexed = session.get("template_ids_by_channel")
    if isinstance(indexed, dict):
        out = {
            normalize_channel(str(k)): str(v).strip()
            for k, v in indexed.items()
            if normalize_channel(str(k)) and str(v).strip()
        }
        if out:
            return out
    by_ch: dict[str, str] = {}
    for row in session.get("templates") or []:
        if not isinstance(row, dict):
            continue
        ch = normalize_channel(str(row.get("channel") or ""))
        tid = str(row.get("template_id") or row.get("id") or "").strip()
        if ch and tid:
            by_ch[ch] = tid
    return by_ch


def build_attach_fields_for_channel(
    existing_fields: dict[str, Any],
    *,
    channel: str,
    image_url: str,
    attach_target: str = "",
    section_index: int | None = None,
) -> dict[str, Any] | None:
    from app.agents.image.hero_image import resolve_image_attach_section_index
    from app.agents.image.template_attach import build_attach_fields

    spec = attach_spec_for_channel(channel)
    if not spec:
        return None
    idx = section_index
    if idx is None and str(attach_target or "").strip():
        idx = resolve_image_attach_section_index(
            existing_fields if isinstance(existing_fields, dict) else {},
            mode="fill",
            attach_target=str(attach_target or ""),
        )
    patch = build_attach_fields(
        existing_fields,
        image_url=image_url,
        field_key=str(spec.get("field_key") or "header_image"),
        only_section_index=idx,
        section_index=idx,
    )
    # Never mirror a URL that failed the media gate (landing / merge tags / relative junk).
    if not patch:
        return None
    for key in spec.get("mirror_keys") or ():
        patch[str(key)] = image_url
    for key, val in (spec.get("extra_fields") or {}).items():
        patch[str(key)] = val
    merged = dict(existing_fields if isinstance(existing_fields, dict) else {})
    merged.update(patch)
    return merged


__all__ = [
    "CHANNEL_ATTACH_SPEC",
    "IMAGE_CAPABLE_CHANNELS",
    "attach_spec_for_channel",
    "build_attach_fields_for_channel",
    "channel_supports_image",
    "eligible_image_channels",
    "normalize_channel_list",
    "resolve_plan_channels",
    "selected_session_channels",
    "template_ids_by_channel",
]
