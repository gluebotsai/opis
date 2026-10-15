"""Factual create-campaign session state for MAS routing (not chat intent parsing)."""

from __future__ import annotations

from typing import Any


def _norm_ch(value: Any) -> str:
    return str(value or "").strip().lower()


def template_ids_by_channel(session: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    by_ch = session.get("template_ids_by_channel")
    if isinstance(by_ch, dict):
        for k, v in by_ch.items():
            ch = _norm_ch(k)
            tid = str(v or "").strip()
            if ch and tid:
                out[ch] = tid
    for row in session.get("templates") or []:
        if not isinstance(row, dict):
            continue
        ch = _norm_ch(row.get("channel"))
        tid = str(row.get("template_id") or row.get("id") or "").strip()
        if ch and tid:
            out.setdefault(ch, tid)
    tid = str(session.get("template_id") or "").strip()
    if tid and not out:
        ch = _norm_ch((session.get("channels") or ["email"])[0] if session.get("channels") else "email")
        out[ch] = tid
    return out


def selected_channels(session: dict[str, Any]) -> list[str]:
    ch = session.get("channels") or []
    if isinstance(ch, list) and ch:
        return [_norm_ch(c) for c in ch if _norm_ch(c)]
    camp = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    raw = camp.get("channels") or []
    if isinstance(raw, list) and raw:
        return [_norm_ch(c) for c in raw if _norm_ch(c)]
    return []


def has_templates_for_channels(session: dict[str, Any], channels: list[str] | None = None) -> bool:
    tmap = template_ids_by_channel(session)
    if not tmap:
        return False
    targets = [_norm_ch(c) for c in (channels or selected_channels(session) or list(tmap.keys()))]
    if not targets:
        return bool(tmap)
    return all(tmap.get(ch) for ch in targets if ch)


def audience_matched_count(session: dict[str, Any]) -> int:
    aud = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    return int(aud.get("matched_count") or 0)


def campaign_meta_complete(session: dict[str, Any]) -> bool:
    camp = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    return bool(
        str(camp.get("name") or "").strip()
        and str(camp.get("goal") or "").strip()
        and str(camp.get("objective") or "").strip()
    )


def image_plan_wants_images(session: dict[str, Any]) -> bool:
    plan = session.get("campaign_image_plan")
    if isinstance(plan, dict) and plan.get("wants_images"):
        return True
    from app.agents.image.plan import get_image_plan

    return bool(get_image_plan(session).get("wants_images"))


def _template_fields_for_channel(
    session: dict[str, Any],
    channel: str,
) -> dict[str, Any]:
    ch_norm = _norm_ch(channel)
    for row in session.get("templates") or []:
        if not isinstance(row, dict):
            continue
        if _norm_ch(row.get("channel")) != ch_norm:
            continue
        fields = row.get("fields")
        if isinstance(fields, dict):
            return fields
    return {}


def channel_template_has_hero(session: dict[str, Any], channel: str) -> bool:
    from app.agents.image.hero_image import fields_have_hero_image

    return fields_have_hero_image(_template_fields_for_channel(session, channel))


def creation_pipeline_context(session: dict[str, Any] | None) -> str:
    """Short factual block for Domain/Super LLM routing."""
    if not isinstance(session, dict):
        return "create_campaign_state: (empty session)"
    import json

    from app.mas.runtime.campaign_setup_snapshot import live_session_facts

    tmap = template_ids_by_channel(session)
    ch = selected_channels(session) or ["(none selected)"]
    facts = live_session_facts(session)
    lines = [
        f"stage: {str(session.get('stage') or 'unknown')}",
        f"channels_selected: {', '.join(ch)}",
        f"campaign_meta_complete: {campaign_meta_complete(session)}",
        f"audience_matched_count: {audience_matched_count(session)}",
        f"template_ids_by_channel: {tmap or '(none)'}",
        f"templates_ready: {has_templates_for_channels(session)}",
        f"image_plan_wants_images: {image_plan_wants_images(session)}",
        f"launch_confirmed: {bool(session.get('launch_confirmed'))}",
        f"campaign_id: {str(session.get('campaign_id') or '') or '(none)'}",
    ]
    try:
        from app.agents.image.user_assets import pending_images_fact_lines

        lines.extend(pending_images_fact_lines(session))
    except Exception:  # noqa: BLE001
        pass
    lines.append(
        "playbook: Creation domain agent.md owns flow — meta → channels → confirm generate → "
        "templates → audience (when needed) → launch. Use live_session_facts + chat memory; "
        "do NOT assume post-turn auto-build or auto-launch."
    )
    if has_templates_for_channels(session):
        lines.append(
            "routing_hint: templates_ready=true — launch/send/schedule requests → "
            "launch_scheduling executor (call launch_campaign), NOT campaign_content."
        )
        lines.append(
            "routing_hint: templates_ready=true — generate/regenerate/create another/"
            "more template THIS turn (including more content as a new template) still "
            "requires invoke_executor campaign_content. Same tools as the first generate. "
            "That mints a NEW template_id with its own HTML. Never patch, empty, or "
            "replace an existing template_id. Do NOT paste a prior 'template created' message. "
            "campaign_content must inspect_session_template then pass content_mode and "
            "image_mode on build_campaign (agent chooses keep vs rewrite / keep vs Gemini)."
        )
        lines.append(
            "routing_hint: templates_ready=true — in-place change of one already-generated "
            "template (that card's View/edit) → do NOT invent rewrite options, do NOT claim "
            "the template changed here, do NOT call plan_campaign_images/attach onto it. "
            "Reply briefly: open View/edit on that template. Keep audience/launch/setup here."
        )
    return (
        "create_campaign_state:\n"
        + "\n".join(f"  {ln}" for ln in lines)
        + "\n\nlive_session_facts:\n"
        + json.dumps(facts, ensure_ascii=False, default=str)
    )


def should_build_templates_before_image(session: dict[str, Any]) -> bool:
    """True when image attach/generate batch requires templates that are missing."""
    if has_templates_for_channels(session):
        return False
    return image_plan_wants_images(session) or bool(selected_channels(session))


def image_attach_incomplete(session: dict[str, Any]) -> bool:
    """True when plan wants images, templates exist, but attach is not finished."""
    if not image_plan_wants_images(session):
        return False
    if not has_templates_for_channels(session):
        return False
    from app.agents.image.plan import get_image_plan, images_by_channel_slot, mark_plan_status

    plan = get_image_plan(session)
    status = str(plan.get("status") or "").strip().lower()
    if status == "attached":
        return False
    mapping = images_by_channel_slot(session)
    plan_channels = list(plan.get("channels") or selected_channels(session))
    tmap = template_ids_by_channel(session)
    pending: list[str] = []
    for ch in plan_channels:
        ch_norm = _norm_ch(ch)
        if ch_norm not in tmap:
            pending.append(ch_norm)
            continue
        if channel_template_has_hero(session, ch_norm):
            continue
        if not str(mapping.get(ch_norm) or mapping.get(ch) or "").strip():
            pending.append(ch_norm)
    if not pending:
        if plan_channels:
            mark_plan_status(session, "attached")
        return False
    return True


def should_build_before_launch(session: dict[str, Any]) -> bool:
    return not has_templates_for_channels(session)


def last_user_turn_pin(session: dict[str, Any]) -> tuple[str | None, int]:
    """Last user message id and 1-based user-turn count (frozen generate pin).

    Never reuse an earlier user's id when the last user message has no id.
    """
    last_id: str | None = None
    count = 0
    for msg in session.get("messages") or []:
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role") or "").strip().lower() != "user":
            continue
        count += 1
        last_id = str(msg.get("id") or "").strip() or None
    return last_id, count


__all__ = [
    "audience_matched_count",
    "campaign_meta_complete",
    "channel_template_has_hero",
    "creation_pipeline_context",
    "has_templates_for_channels",
    "image_attach_incomplete",
    "image_plan_wants_images",
    "last_user_turn_pin",
    "selected_channels",
    "should_build_before_launch",
    "should_build_templates_before_image",
    "template_ids_by_channel",
]
