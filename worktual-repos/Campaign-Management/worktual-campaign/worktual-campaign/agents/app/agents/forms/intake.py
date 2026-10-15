"""Forms agent intake — campaign handoff validation and rich carry_query."""

from __future__ import annotations

from typing import Any

from app.agents.routing import set_pending_route


def form_readiness(design: dict[str, Any] | None) -> dict[str, Any]:
    """Summarize whether the form is ready to hand off."""
    d = design if isinstance(design, dict) else {}
    fields = d.get("fields") if isinstance(d.get("fields"), list) else []
    labels = [
        str(f.get("label") or "").strip()
        for f in fields
        if isinstance(f, dict) and str(f.get("label") or "").strip()
    ]
    public_url = str(d.get("public_url") or d.get("publicUrl") or "").strip()
    title = str(d.get("title") or "").strip() or "Untitled form"
    return {
        "title": title,
        "field_count": len(fields),
        "field_labels": labels,
        "published": bool(public_url),
        "public_url": public_url or None,
        "ready": len(fields) >= 1 and bool(title),
    }


def build_campaign_handoff_query(
    session: dict[str, Any],
    *,
    campaign_goal: str = "",
) -> str:
    """One-line context for create-campaign join (`carry_query`)."""
    design = session.get("form_design") if isinstance(session.get("form_design"), dict) else {}
    readiness = form_readiness(design)
    event_id = str(session.get("form_event_id") or "").strip()
    parts: list[str] = []

    goal = (campaign_goal or "").strip()
    if goal:
        parts.append(f'{goal.rstrip(".")} for form "{readiness["title"]}"')
    else:
        parts.append(
            f'Create a campaign to drive submissions for form "{readiness["title"]}"'
        )

    if readiness["field_labels"]:
        parts.append(f"Fields: {', '.join(readiness['field_labels'][:8])}.")
    if readiness["public_url"]:
        parts.append(f"Form URL: {readiness['public_url']}.")
    elif not readiness["published"]:
        parts.append(
            "Form is not published yet — user may publish from the editor for a public link."
        )
    if event_id:
        parts.append(f"form_event_id={event_id}.")
    return " ".join(parts).strip()


def handoff_context(readiness: dict[str, Any]) -> dict[str, Any]:
    """Factual form summary for the LLM (tool result) — not a user-facing script."""
    title = readiness.get("title") or "this form"
    n = int(readiness.get("field_count") or 0)
    return {
        "form_title": title,
        "field_count": n,
        "published": bool(readiness.get("public_url")),
        "public_url": readiness.get("public_url"),
    }


def confirmation_prompt(readiness: dict[str, Any]) -> str:
    """Backward-compatible facts string for tests — LLM writes the actual ask."""
    ctx = handoff_context(readiness)
    title = ctx["form_title"]
    n = ctx["field_count"]
    msg = f'"{title}" has {n} field{"s" if n != 1 else ""}.'
    if ctx.get("public_url"):
        msg += f" Published link: {ctx['public_url']}."
    else:
        msg += (
            " Form is not published yet — user may publish from the editor for a public link."
        )
    return msg


def queue_campaign_handoff(
    session: dict[str, Any],
    *,
    campaign_goal: str = "",
) -> dict[str, Any]:
    """Validate form and store pending handoff; does not navigate yet."""
    design = session.get("form_design") if isinstance(session.get("form_design"), dict) else {}
    readiness = form_readiness(design)
    if not readiness["ready"]:
        return {
            "ok": False,
            "error": (
                "Form needs a title and at least one field before opening Create campaign. "
                "Use RUN_FIELDS_SPECIALIST or RUN_DESIGN_SPECIALIST first."
            ),
        }
    query = build_campaign_handoff_query(session, campaign_goal=campaign_goal)
    set_pending_route(session, module="create_campaign", query=query, create=False)
    return {
        "ok": True,
        "status": "pending_confirmation",
        "needs_confirmation": True,
        "message": confirmation_prompt(readiness),
        "handoff_context": handoff_context(readiness),
        "query": query,
        "field_count": readiness["field_count"],
        "published": readiness["published"],
    }
