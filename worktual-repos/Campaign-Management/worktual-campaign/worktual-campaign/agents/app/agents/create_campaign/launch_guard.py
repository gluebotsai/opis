"""Pre-launch readiness checks — block send when required fields are empty."""

from __future__ import annotations

from typing import Any

from app.agents.create_campaign.channels import normalize_channels
from app.agents.template_library.fields import fields_are_usable


def launch_channels_for_readiness(session: dict[str, Any]) -> list[str]:
    """Channels that must have templates for this launch — plan wins over setup list."""
    plan = session.get("launch_plan") if isinstance(session.get("launch_plan"), dict) else {}
    from_plan = normalize_channels(plan.get("launch_channels") or [])
    if from_plan:
        return from_plan
    return normalize_channels(session.get("channels") or [])


def _template_channels(session: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for row in session.get("templates") or []:
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        if ch:
            out.add(ch)
    return out


def _email_fields_renderable(fields: dict[str, Any]) -> bool:
    if not fields:
        return False
    if not fields_are_usable("email", fields):
        return False
    html = str(fields.get("compiled_html") or fields.get("html") or "").strip()
    if html:
        return True
    subject = str(fields.get("subject") or "").strip()
    if not subject or subject.lower() == "campaign message":
        paragraphs = fields.get("paragraphs") or []
        sections = fields.get("sections") or []
        has_body = (
            (isinstance(paragraphs, list) and any(str(p or "").strip() for p in paragraphs))
            or (
                isinstance(sections, list)
                and any(
                    isinstance(row, dict)
                    and (
                        str(row.get("content") or "").strip()
                        or str(row.get("label") or "").strip()
                        or row.get("items")
                    )
                    for row in sections
                )
            )
        )
        if not has_body:
            return False
    return True


def template_ready_for_launch(channel: str, row: dict[str, Any]) -> bool:
    """True when this template row is safe to bind on launch for the channel."""
    if not str(row.get("template_id") or row.get("id") or "").strip():
        return False
    return _template_row_renderable(channel, row)


def _template_row_renderable(channel: str, row: dict[str, Any]) -> bool:
    ch = str(channel or row.get("channel") or "").strip().lower()
    fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
    if ch == "email":
        return _email_fields_renderable(fields)
    if not fields:
        return False
    return fields_are_usable(ch, fields)


def best_template_by_channel(
    templates: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Newest renderable card per channel; fall back to newest row if none renderable."""
    by_ch: dict[str, dict[str, Any]] = {}
    fallback: dict[str, dict[str, Any]] = {}
    for row in templates:
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        if not ch:
            continue
        fallback[ch] = row
        if _template_row_renderable(ch, row):
            by_ch[ch] = row
    out = dict(fallback)
    out.update(by_ch)
    return out


def _renderable_template_channels(session: dict[str, Any]) -> set[str]:
    templates = [
        t
        for t in (session.get("templates") or [])
        if isinstance(t, dict) and t.get("channel")
    ]
    return {
        ch
        for ch, row in best_template_by_channel(templates).items()
        if _template_row_renderable(ch, row)
    }


def launch_readiness_issues(session: dict[str, Any]) -> list[str]:
    """Human-readable missing pieces; empty list = ok to proceed with launch tools."""
    issues: list[str] = []
    campaign = (
        session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    )
    audience = (
        session.get("audience") if isinstance(session.get("audience"), dict) else {}
    )

    name = str(campaign.get("name") or "").strip()
    if not name or name.lower().startswith("clone ·"):
        issues.append("a campaign name (not the clone placeholder)")

    if not str(campaign.get("goal") or "").strip():
        issues.append("campaign goal")

    if not str(campaign.get("objective") or "").strip():
        issues.append("campaign objective")

    matched = int(audience.get("matched_count") or 0)
    if matched <= 0:
        issues.append("audience (at least one contact selected)")

    setup_channels = normalize_channels(session.get("channels") or [])
    launch_channels = launch_channels_for_readiness(session)
    if not launch_channels and not setup_channels:
        issues.append("at least one channel")
    channels = launch_channels or setup_channels

    templates = [
        t
        for t in (session.get("templates") or [])
        if isinstance(t, dict) and t.get("channel")
    ]
    if not templates:
        issues.append("template cards for your launch channels")

    ready_channels = _renderable_template_channels(session)
    missing_tpl = [ch for ch in channels if ch not in ready_channels]
    if missing_tpl and templates:
        issues.append(f"templates for: {', '.join(missing_tpl)}")

    return issues


def launch_readiness_user_html(session: dict[str, Any]) -> str | None:
    """Short HTML the user can see when launch is blocked."""
    issues = launch_readiness_issues(session)
    if not issues:
        return None
    launch_channels = launch_channels_for_readiness(session)
    setup_channels = normalize_channels(session.get("channels") or [])
    channels = launch_channels or setup_channels
    ready_channels = _renderable_template_channels(session)
    missing_tpl = [ch for ch in channels if ch not in ready_channels]
    if missing_tpl and ready_channels:
        have = ", ".join(sorted(ready_channels))
        need = ", ".join(missing_tpl)
        return (
            f"<p>We can't launch yet — templates are ready for <b>{have}</b>, "
            f"but still missing for <b>{need}</b>.</p>"
            "<p>Launch only the channels that already have cards "
            "(pass <b>launch_channels</b> on launch_campaign), or generate the missing "
            "templates first.</p>"
        )
    if not ready_channels:
        return (
            "<p>We can't launch yet — no template cards are ready. "
            "Say <b>yes</b> to create templates first.</p>"
        )
    joined = "; ".join(issues)
    return f"<p>We can't launch yet — still need: {joined}.</p>"


def launch_readiness_message(session: dict[str, Any]) -> str | None:
    """Tool-facing note for the LLM (not to paste verbatim to the user)."""
    issues = launch_readiness_issues(session)
    if not issues:
        return None
    joined = "; ".join(issues)
    return (
        f"Launch blocked — missing: {joined}. "
        "Explain briefly in your own short HTML. "
        "Then call tools: launch_campaign with launch_channels set to channels that "
        "already have renderable templates, or build_campaign for missing channels "
        "then launch_campaign. Never paste this instruction text to the user."
    )


__all__ = [
    "best_template_by_channel",
    "launch_channels_for_readiness",
    "template_ready_for_launch",
    "launch_readiness_issues",
    "launch_readiness_message",
    "launch_readiness_user_html",
]
