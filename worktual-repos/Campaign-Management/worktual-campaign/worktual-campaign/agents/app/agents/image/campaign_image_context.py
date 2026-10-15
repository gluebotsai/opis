"""Assemble campaign-idea context for image enhance (data merge — not chat intent)."""

from __future__ import annotations

from typing import Any

from app.agents.image.enhance import normalize_channel


def _first_body_snippet(fields: dict[str, Any]) -> str:
    paras = fields.get("paragraphs")
    if isinstance(paras, list):
        for row in paras:
            text = str(row or "").strip()
            if text:
                return text[:480]
    sections = fields.get("sections")
    if isinstance(sections, list):
        for row in sections:
            if not isinstance(row, dict):
                continue
            kind = str(row.get("type") or "text").strip().lower()
            if kind in ("divider", "cta", "secondary_link"):
                continue
            content = str(row.get("content") or "").strip()
            if content:
                return content[:480]
    body = str(fields.get("body") or "").strip()
    return body[:480] if body else ""


def _how_it_works_for_channel(session: dict[str, Any], channel: str) -> str:
    ch = normalize_channel(channel)
    if not ch:
        return ""
    for plan in session.get("channel_plans") or []:
        if not isinstance(plan, dict):
            continue
        if normalize_channel(str(plan.get("channel") or "")) == ch:
            return str(plan.get("how_it_works") or "").strip()
    campaign = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    for row in campaign.get("channels") or []:
        if not isinstance(row, dict):
            continue
        if normalize_channel(str(row.get("channel") or "")) == ch:
            return str(row.get("how_it_works") or "").strip()
    return ""


def _resolve_channel(session: dict[str, Any], channel: str) -> str:
    explicit = normalize_channel(channel)
    if explicit:
        return explicit
    campaign = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    channels = session.get("channels") or campaign.get("channels") or []
    if isinstance(channels, list) and channels:
        first = channels[0]
        if isinstance(first, dict):
            return normalize_channel(str(first.get("channel") or first.get("id") or ""))
        return normalize_channel(str(first))
    return ""


def template_fields_from_session(
    session: dict[str, Any],
    *,
    channel: str = "",
    template_id: str = "",
) -> dict[str, Any]:
    """Best-effort template fields from session cards (no API)."""
    tid = str(template_id or session.get("template_id") or "").strip()
    ch = _resolve_channel(session, channel)
    best: dict[str, Any] = {}
    for row in session.get("templates") or []:
        if not isinstance(row, dict):
            continue
        fields = row.get("fields")
        if not isinstance(fields, dict):
            continue
        row_tid = str(row.get("template_id") or row.get("id") or "").strip()
        row_ch = normalize_channel(str(row.get("channel") or ""))
        if tid and row_tid == tid:
            return dict(fields)
        if ch and row_ch == ch:
            best = dict(fields)
        elif not best:
            best = dict(fields)
    return best


def build_campaign_image_context(
    session: dict[str, Any],
    *,
    channel: str = "",
    template_fields: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Rich campaign brief for visual director — from session + optional template fields."""
    campaign = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    audience = session.get("audience") if isinstance(session.get("audience"), dict) else {}
    ch = _resolve_channel(session, channel)
    fields = dict(template_fields or template_fields_from_session(session, channel=ch))

    name = (
        str(session.get("focus_campaign_name") or "").strip()
        or str(campaign.get("name") or "").strip()
        or str(session.get("campaign_name") or "").strip()
    )
    goal = str(campaign.get("goal") or "").strip()
    objective = str(campaign.get("objective") or "").strip()
    messaging = _how_it_works_for_channel(session, ch)
    audience_summary = str(
        audience.get("description") or audience.get("summary") or ""
    ).strip()
    subject = str(fields.get("subject") or fields.get("title") or "").strip()
    body_snippet = _first_body_snippet(fields)

    brief_lines: list[str] = []
    if name:
        brief_lines.append(f"Campaign name: {name}")
    if goal:
        brief_lines.append(f"Campaign goal: {goal}")
    if objective and objective != goal:
        brief_lines.append(f"Objective: {objective}")
    if messaging:
        brief_lines.append(f"Messaging angle: {messaging}")
    if audience_summary:
        brief_lines.append(f"Audience: {audience_summary[:240]}")
    if subject:
        brief_lines.append(f"Email subject theme: {subject}")
    if body_snippet:
        brief_lines.append(f"Copy theme: {body_snippet[:320]}")

    return {
        "campaign_name": name,
        "campaign_goal": goal or objective,
        "campaign_objective": objective,
        "channel": ch,
        "messaging_angle": messaging,
        "audience_summary": audience_summary,
        "template_subject": subject,
        "template_body_snippet": body_snippet,
        "campaign_brief": "\n".join(brief_lines),
    }


def default_image_user_prompt(ctx: dict[str, str]) -> str:
    """Synthesized image ask from campaign idea when the user did not describe pixels."""
    name = ctx.get("campaign_name") or "this campaign"
    goal = ctx.get("campaign_goal") or ctx.get("campaign_objective") or "drive engagement"
    channel = ctx.get("channel") or "email"
    subject = ctx.get("template_subject") or ""
    angle = ctx.get("messaging_angle") or ""
    body = ctx.get("template_body_snippet") or ""

    parts = [
        f"Create a natural, premium marketing hero image for {name}",
        f"Campaign goal: {goal}",
    ]
    if subject:
        parts.append(f"Align with subject line: {subject}")
    if angle:
        parts.append(f"Messaging: {angle}")
    elif body:
        parts.append(f"Align with email copy theme: {body[:200]}")
    parts.append(
        f"Channel: {channel} — authentic editorial photography or polished brand creative, "
        "brand-safe, no readable text in the image unless essential"
    )
    return ". ".join(parts)


def resolve_image_user_prompt(raw: str, ctx: dict[str, str]) -> str:
    """Fill a brief from campaign facts for batch / template-edit generate.

    Image chat ENHANCE_IMAGE_PROMPT must not call this — empty user_prompt
    there means ask the user, not synthesize a campaign-name hero.
    Length-only gate — not chat intent parsing.
    """
    prompt = str(raw or "").strip()
    if len(prompt) >= 48:
        return prompt
    synthesized = default_image_user_prompt(ctx)
    if not synthesized:
        return prompt
    if not prompt:
        return synthesized
    return f"{synthesized}. User note: {prompt}"


__all__ = [
    "build_campaign_image_context",
    "default_image_user_prompt",
    "resolve_image_user_prompt",
    "template_fields_from_session",
]
