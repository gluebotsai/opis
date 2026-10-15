"""Tool handlers for recommendation agent."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from app.agents.create_campaign.schedule_agent import recommend_send_time
from app.agents.recommendations.past_campaigns import fetch_past_campaigns
from app.agents.routing import dispatch_route_to_module
from app.session_store import get_or_create_session, save_session

logger = logging.getLogger(__name__)


def _normalize_channel(raw: str) -> str:
    c = str(raw or "").strip()
    mapping = {
        "email": "Email",
        "sms": "SMS",
        "whatsapp": "WhatsApp",
        "web": "Web Push",
        "web_push": "Web Push",
        "webpush": "Web Push",
        "push": "App Push",
        "app_push": "App Push",
        "app push": "App Push",
        "web push": "Web Push",
    }
    key = c.lower()
    if key in mapping:
        return mapping[key]
    for label in ("Email", "SMS", "WhatsApp", "Web Push", "App Push"):
        if c.lower() == label.lower():
            return label
    return c.title() if c else "Email"


def _normalize_recommendations(raw: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in raw or []:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        goal = str(row.get("goal") or "").strip() or f"Run {title}"
        objective = (
            str(row.get("objective") or "").strip()
            or str(row.get("intended_use") or row.get("intendedUse") or "").strip()
            or goal
        )
        why_created = str(
            row.get("why_created") or row.get("whyCreated") or row.get("why") or ""
        ).strip() or (
            "Suggested from your recent campaigns."
            if row.get("inspired_by_campaign")
            else "Knowledge-based start — fill in goal, audience, and timing before launch."
        )
        timing_label = str(
            row.get("timing_label") or row.get("timingLabel") or ""
        ).strip() or "Next weekday 10:00"
        channels = [
            _normalize_channel(str(c))
            for c in (row.get("channels") or [])
            if str(c).strip()
        ]
        templates = []
        for t in row.get("templates") or []:
            if not isinstance(t, dict):
                continue
            channel = _normalize_channel(str(t.get("channel") or ""))
            name = str(t.get("name") or "").strip() or f"{channel} template"
            preview = str(t.get("preview") or "").strip()
            if not preview:
                continue
            templates.append({"channel": channel, "name": name, "preview": preview})
        if not channels and templates:
            channels = list({t["channel"] for t in templates})
        if not channels:
            channels = ["Email"]
        if not templates:
            for ch in channels:
                templates.append(
                    {
                        "channel": ch,
                        "name": f"{ch} draft",
                        "preview": objective or goal,
                    }
                )
        inspired = str(row.get("inspired_by_campaign") or "").strip()
        intended = str(
            row.get("intended_use") or row.get("intendedUse") or objective
        ).strip()
        out.append(
            {
                "id": str(row.get("id") or f"rec-{uuid.uuid4().hex[:10]}"),
                "title": title,
                "goal": goal,
                "objective": objective,
                "timing_label": timing_label,
                "event_name": str(
                    row.get("event_name") or row.get("eventName") or title
                ).strip(),
                "audience": str(row.get("audience") or "Selected contacts").strip(),
                "channels": channels,
                "why": why_created,
                "why_created": why_created,
                "intended_use": intended,
                "inspired_by_campaign": inspired or "knowledge",
                "contacts_specified": bool(
                    row.get("contacts_specified")
                    if row.get("contacts_specified") is not None
                    else row.get("contactsSpecified")
                ),
                "matched_count": row.get("matched_count", row.get("matchedCount")),
                "audience_filters": row.get("audience_filters")
                or row.get("audienceFilters"),
                "contacts_missing_reason": str(
                    row.get("contacts_missing_reason")
                    or row.get("contactsMissingReason")
                    or "Audience is a recommendation — resolve contacts in create-campaign."
                ).strip()
                or None,
                "ai_generated": True,
                "templates": templates,
            }
        )
    return out


def _cards_from_history(campaigns: list[Any]) -> list[dict[str, Any]]:
    """Turn recent launched campaigns into follow-up board cards."""
    raw: list[dict[str, Any]] = []
    for row in campaigns or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        channels = row.get("channels") or ["Email"]
        if not isinstance(channels, list) or not channels:
            channels = ["Email"]
        sent = int(row.get("sent") or 0)
        opens = int(row.get("opens") or 0)
        why = (
            f"Follow-up on {name} ({sent} sent, {opens} opens)."
            if sent
            else f"Continue from {name}."
        )
        raw.append(
            {
                "title": f"{name} follow-up",
                "goal": str(row.get("goal") or "").strip() or f"Extend {name}",
                "objective": str(row.get("objective") or "").strip()
                or f"Reach the same audience as {name} with a fresh send.",
                "audience": str(row.get("audience") or "Previous campaign audience").strip(),
                "channels": channels,
                "why_created": why,
                "timing_label": "Next weekday 10:00",
                "inspired_by_campaign": name,
            }
        )
        if len(raw) >= 4:
            break
    return _normalize_recommendations(raw)


def _knowledge_starter_cards() -> list[dict[str, Any]]:
    """Board ideas when the model returns nothing and there is no send history."""
    return _normalize_recommendations(
        [
            {
                "title": "Welcome / awareness",
                "goal": "Introduce the product to new and quiet contacts",
                "objective": "Get a first open from people who have not engaged yet",
                "audience": "All contacts with email",
                "channels": ["Email"],
                "why_created": "Knowledge-based start because no completed sends were available to clone.",
                "timing_label": "Next weekday 10:00",
                "inspired_by_campaign": "knowledge",
            },
            {
                "title": "Re-engage quiet contacts",
                "goal": "Win back people who have gone quiet",
                "objective": "Prompt a reply or click from inactive contacts",
                "audience": "Contacts with no recent engagement",
                "channels": ["Email", "WhatsApp"],
                "why_created": "Knowledge-based start because no completed sends were available to clone.",
                "timing_label": "Next weekday 10:00",
                "inspired_by_campaign": "knowledge",
            },
            {
                "title": "Clear offer or reminder",
                "goal": "Drive one action this week",
                "objective": "Get registrations or replies with a single CTA",
                "audience": "All reachable contacts",
                "channels": ["Email"],
                "why_created": "Knowledge-based start because no completed sends were available to clone.",
                "timing_label": "Next weekday 10:00",
                "inspired_by_campaign": "knowledge",
            },
        ]
    )


def _peak_from_insight(insight: dict[str, Any] | None) -> dict[str, Any]:
    if not insight or not insight.get("has_peak"):
        return {}
    try:
        return {
            "peak_weekday": int(insight.get("peak_weekday")),
            "peak_hour": int(insight.get("peak_hour")),
            "peak_weekday_name": str(insight.get("peak_weekday_name") or ""),
            "peak_reason": str(insight.get("reason") or ""),
        }
    except (TypeError, ValueError):
        return {}


def _apply_business_send_windows(
    items: list[dict[str, Any]],
    *,
    insight: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    peak = _peak_from_insight(insight)
    out: list[dict[str, Any]] = []
    for item in items:
        row = dict(item)
        hint = " ".join(
            str(x)
            for x in (
                row.get("timing_label"),
                row.get("event_name"),
                row.get("why_created"),
                row.get("why"),
            )
            if x
        )
        window = recommend_send_time(user_text=hint, prefer_now=False, **peak)
        row["timing_label"] = window.get("timing_label") or row.get("timing_label")
        row["suggested_launch_at"] = window.get("scheduled_at")
        row["suggested_launch_local_date"] = window.get("launch_local_date")
        row["suggested_launch_local_time"] = window.get("launch_local_time")
        row["suggested_launch_timezone"] = window.get("timezone")
        row["schedule_adjusted"] = bool(window.get("adjusted"))
        row["schedule_reason"] = window.get("reason")
        out.append(row)
    return out


async def store_past_campaigns(session_id: str, token: str) -> dict[str, Any]:
    past = await fetch_past_campaigns(token)
    session = await get_or_create_session(
        session_id, token=token, module="recommendations"
    )
    session["past_campaigns"] = past.get("campaigns") or []
    session["past_has_history"] = bool(past.get("has_past"))
    await save_session(session, token=token)
    return past


async def handle_load_past_campaigns(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    past = await store_past_campaigns(session_id, token)
    return {
        "ok": bool(past.get("ok", True)),
        "has_past": bool(past.get("has_past")),
        "count": int(past.get("count") or 0),
        "campaigns": past.get("campaigns") or [],
        "error": past.get("error"),
        "change_summary": str(args.get("change_summary") or "").strip(),
        "message": (
            f"Loaded {int(past.get('count') or 0)} past campaign(s)."
            if past.get("has_past")
            else "No past campaigns. Recommend from knowledge."
        ),
    }


async def generate_recommendations(
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback=None,
) -> dict[str, Any]:
    session = await get_or_create_session(
        session_id, token=token, module="recommendations"
    )
    if session.get("past_campaigns") is None:
        await store_past_campaigns(session_id, token)
        session = await get_or_create_session(
            session_id, token=token, module="recommendations"
        )

    incoming = args.get("recommendations") or []
    items = _normalize_recommendations(incoming)
    if not items:
        items = _cards_from_history(session.get("past_campaigns") or [])
    if not items:
        items = _knowledge_starter_cards()
    logger.info(
        "GENERATE_RECOMMENDATIONS sid=%s incoming=%s kept=%s titles=%s",
        session_id,
        len(incoming) if isinstance(incoming, list) else 0,
        len(items),
        [i.get("title") for i in items[:6]],
    )
    if items:
        insight = None
        try:
            from app.agents.create_campaign.tool_functions import (
                _fetch_send_time_insight,
            )

            insight = await asyncio.wait_for(
                _fetch_send_time_insight(token), timeout=5.0
            )
        except Exception:  # noqa: BLE001
            insight = None
        items = _apply_business_send_windows(items, insight=insight)

    session["recommendations"] = items
    session["stage"] = "recommendations_ready"
    session = await save_session(session, token=token)

    ui_event = {
        "type": "recommendation_cards",
        "payload": items,
        "replace_active": True,
    }
    if event_callback:
        await event_callback(ui_event)

    return {
        "ok": True,
        "count": len(items),
        "has_past": bool(session.get("past_has_history")),
        "titles": [i["title"] for i in items],
        "focus": str(args.get("focus") or "").strip(),
        "change_summary": str(args.get("change_summary") or "").strip(),
        "ui_event": ui_event,
        "message": (
            f"Board updated with {len(items)} idea(s)."
            if items
            else "No recommendation cards — nothing useful to show."
        ),
    }


async def dispatch_tool(
    name: str,
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback=None,
) -> dict[str, Any]:
    if name == "LOAD_PAST_CAMPAIGNS":
        return await handle_load_past_campaigns(session_id, token, args)
    if name == "GENERATE_RECOMMENDATIONS":
        return await generate_recommendations(
            session_id, token, args, event_callback=event_callback
        )
    if name == "ROUTE_TO_MODULE":
        return await dispatch_route_to_module(args)
    return {"ok": False, "error": f"Unknown tool: {name}"}
