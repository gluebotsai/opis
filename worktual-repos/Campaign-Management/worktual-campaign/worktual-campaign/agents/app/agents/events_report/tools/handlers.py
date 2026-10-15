"""Handlers for events report tools — read session events_snapshot only."""

from __future__ import annotations

from typing import Any

from app.session_store import get_or_create_session, save_session
from app.agents.routing import dispatch_route_to_module

MODULE = "events_report"


def _events_blob(session: dict[str, Any]) -> dict[str, Any]:
    raw = session.get("events_snapshot")
    return raw if isinstance(raw, dict) else {}


def _all_events(blob: dict[str, Any]) -> list[dict[str, Any]]:
    launched = list(blob.get("launched") or blob.get("events") or [])
    drafts = list(blob.get("drafts") or [])
    # Prefer explicit lists; avoid double-counting.
    by_id: dict[str, dict[str, Any]] = {}
    for row in launched + drafts:
        if not isinstance(row, dict):
            continue
        eid = str(row.get("id") or "").strip()
        if eid:
            by_id[eid] = row
        else:
            by_id[f"anon-{len(by_id)}"] = row
    return list(by_id.values())


async def handle_list(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token, module=MODULE)
    blob = _events_blob(session)
    rows = _all_events(blob)
    status = str(args.get("status") or "all").strip().lower()
    kind = str(args.get("kind") or "").strip().lower()
    include_drafts = args.get("include_drafts")
    if include_drafts is None:
        include_drafts = True

    items: list[dict[str, Any]] = []
    for r in rows:
        st = str(r.get("status") or "").strip().lower()
        if not include_drafts and st == "draft":
            continue
        if status != "all" and st != status:
            continue
        k = str(r.get("kind") or "").strip().lower()
        if kind and k != kind:
            continue
        items.append(
            {
                "id": r.get("id"),
                "title": r.get("title"),
                "kind": r.get("kind"),
                "status": r.get("status"),
                "launched_at": r.get("launchedAt") or r.get("launched_at"),
                "starts_at": r.get("startsAt") or r.get("starts_at"),
                "ends_at": r.get("endsAt") or r.get("ends_at"),
                "public_slug": r.get("publicSlug") or r.get("public_slug"),
                "submission_count": r.get("submissionCount")
                if r.get("submissionCount") is not None
                else r.get("submission_count") or 0,
                "open_count": r.get("openCount")
                if r.get("openCount") is not None
                else r.get("open_count") or 0,
            }
        )

    session["last_action"] = "list_events"
    await save_session(session, token=token)
    return {
        "ok": True,
        "count": len(items),
        "events": items,
        "message": args.get("change_summary") or f"{len(items)} event(s).",
    }


async def handle_detail(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token, module=MODULE)
    blob = _events_blob(session)
    rows = _all_events(blob)
    event_id = str(args.get("event_id") or "").strip()
    title = str(args.get("title") or "").strip().lower()

    match: dict[str, Any] | None = None
    if event_id:
        for r in rows:
            if str(r.get("id") or "") == event_id:
                match = r
                break
    if match is None and title:
        for r in rows:
            if title in str(r.get("title") or "").strip().lower():
                match = r
                break
    if match is None:
        return {"ok": False, "error": "Event not found in snapshot."}

    eid = str(match.get("id") or "")
    submissions = list(blob.get("submissions") or [])
    related = [
        s
        for s in submissions
        if isinstance(s, dict)
        and (
            str(s.get("formId") or s.get("form_id") or "") == eid
            or str(s.get("event_id") or "") == eid
        )
    ][:20]

    detail = {
        "id": match.get("id"),
        "title": match.get("title"),
        "description": match.get("description"),
        "kind": match.get("kind"),
        "status": match.get("status"),
        "launched_at": match.get("launchedAt") or match.get("launched_at"),
        "starts_at": match.get("startsAt") or match.get("starts_at"),
        "ends_at": match.get("endsAt") or match.get("ends_at"),
        "public_slug": match.get("publicSlug") or match.get("public_slug"),
        "submission_count": match.get("submissionCount")
        if match.get("submissionCount") is not None
        else match.get("submission_count") or 0,
        "open_count": match.get("openCount")
        if match.get("openCount") is not None
        else match.get("open_count") or 0,
        "form_fields": match.get("formFields") or match.get("form_fields") or [],
        "thank_you_message": match.get("thankYouMessage")
        or match.get("thank_you_message"),
        "recent_submissions": related,
    }
    session["last_event_report"] = detail
    session["last_action"] = "event_detail"
    await save_session(session, token=token)
    return {
        "ok": True,
        "event": detail,
        "message": args.get("change_summary") or "Event detail loaded.",
    }


async def dispatch_tool(
    session_id: str, token: str, name: str, args: dict[str, Any]
) -> dict[str, Any]:
    if name == "LIST_EVENTS":
        return await handle_list(session_id, token, args)
    if name == "GET_EVENT_DETAIL":
        return await handle_detail(session_id, token, args)
    if name == "ROUTE_TO_MODULE":
        return await dispatch_route_to_module(args)
    return {"ok": False, "error": f"Unknown tool: {name}"}
