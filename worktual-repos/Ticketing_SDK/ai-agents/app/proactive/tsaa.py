"""TSAA — continuous ticket summary (LLM over ticket + recent activity)."""

from __future__ import annotations

import time
from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, run_agent_llm

SPEC = AgentSpec(
    agent_id="tsaa",
    trigger=(
        "ticket.created",
        "ticket.comment_added",
        "customer.replied",
        "ticket.updated",
        "ticket.escalated",
        "ticket.sla_at_risk",
        "icpa.completed",
        "on_demand.summary",
    ),
    inputs_required=("organization_id",),
    tools_used=frozenset(
        {
            "get_ticket",
            "update_ticket",
            "get_ticket_progress",
            "list_ticket_notes",
            "list_tickets",
        }
    ),
    output_type="ACTION_PROPOSAL",
    risk_level="low",
    confidence_threshold=0.5,
    audit_event="proactive.tsaa",
    full_name="Ticket Summary Assistant",
)

_last: dict[str, float] = {}
DEBOUNCE_S = 8.0
_NOTES_CAP = 20
_CLOSED = frozenset({"closed", "resolved", "solved", "cancelled", "canceled"})


def _norm_tn(raw: str) -> str:
    tn = (raw or "").strip()
    if tn and not tn.startswith("#") and tn.lstrip("#").isdigit():
        return f"#{tn.lstrip('#')}"
    return tn


def _payload(event: dict[str, Any]) -> dict[str, Any]:
    p = event.get("payload")
    return p if isinstance(p, dict) else {}


def _truthy(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    return str(val or "").strip().lower() in {"1", "true", "yes"}


def _summary_kind(event: dict[str, Any]) -> str:
    et = str(event.get("event_type") or "")
    p = _payload(event)
    if et == "ticket.created":
        return "created"
    if et == "on_demand.summary":
        return "on_demand"
    if et == "ticket.escalated" or p.get("escalate") or p.get("escalated"):
        return "escalation"
    if et == "ticket.sla_at_risk":
        return "sla"
    if et == "icpa.completed":
        return "rolling"
    if et == "customer.replied":
        return "gap_refresh" if p.get("channel") else "rolling"
    if et == "ticket.comment_added":
        return "rolling"
    prev = str(p.get("prev_status") or "").strip().lower()
    new = str(p.get("new_status") or p.get("status") or "").strip().lower()
    status_changed = _truthy(p.get("statusChanged") or p.get("status_changed"))
    if new in _CLOSED or new == "resolved":
        return "resolution"
    if new == "reopened" or (prev in _CLOSED and new and new not in _CLOSED):
        return "reopen"
    if status_changed and new:
        # Custom terminal/active labels still count as a lifecycle rewrite.
        if any(tok in new for tok in ("close", "resolv", "done", "complet")):
            return "resolution"
        if "reopen" in new:
            return "reopen"
    if p.get("assignee_changed") or p.get("resolver_changed") or _truthy(
        p.get("assigneeChanged")
    ) or _truthy(p.get("resolverChanged")):
        return "handover"
    return "rolling"


def _must_run_now(event: dict[str, Any], kind: str) -> bool:
    """Lifecycle turns always rewrite — never lose a resolve/reopen to debounce."""
    et = str(event.get("event_type") or "")
    if et in {"on_demand.summary", "ticket.created"}:
        return True
    if kind in {"resolution", "reopen", "escalation", "handover"}:
        return True
    p = _payload(event)
    return _truthy(p.get("statusChanged") or p.get("status_changed"))


def _format_summary(obj: dict[str, Any], kind: str) -> str:
    """Prefer one overall narrative paragraph for tickets.ai_summary.

    Labeled sections (Resolution:/Handover:/…) are optional LLM detail only —
    never replace the main summary with a static status echo.
    """
    direct = str(obj.get("summary") or "").strip()
    if direct:
        return direct
    # Fallback when the model omitted summary but filled a section.
    parts: list[str] = []
    for key in (
        "handover_brief",
        "conversation",
        "investigation",
        "actions_taken",
        "resolution",
    ):
        val = str(obj.get(key) or "").strip()
        if val:
            parts.append(val)
    return " ".join(parts).strip()


def _issue_ticket_view(
    ticket: dict[str, Any],
    tn: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Subject/description (and contact/channel) only — no assign/status/history."""
    src = ticket if isinstance(ticket, dict) else {}
    extra = payload if isinstance(payload, dict) else {}

    def pick(*keys: str) -> Any:
        for key in keys:
            val = src.get(key)
            if val is not None and str(val).strip():
                return val
            val = extra.get(key)
            if val is not None and str(val).strip():
                return val
        return None

    out: dict[str, Any] = {
        "ticketNumber": src.get("ticketNumber")
        or src.get("ticket_number")
        or extra.get("ticket_number")
        or tn
    }
    subject = pick("subject")
    description = pick("description")
    customer = pick("customerName", "customer_name", "customer")
    channel = pick("channel")
    if subject:
        out["subject"] = subject
    if description:
        out["description"] = description
    if customer:
        out["customerName"] = customer
    if channel:
        out["channel"] = channel
    return out


def _issue_focused_summary(kind: str, event_type: str, notes: list[Any]) -> bool:
    """Description summary of the request — not post-create assign/queue/status."""
    if kind == "created":
        return True
    if event_type == "icpa.completed":
        return True
    if event_type == "ticket.updated" and kind in {"handover", "rolling"}:
        return not notes
    return False


def _lifecycle_hint(ticket: dict[str, Any], system_events: list[dict[str, Any]]) -> str:
    """Compact facts so the LLM can write create→assign→now without inventing."""
    bits: list[str] = []
    created = (
        ticket.get("createdAt")
        or ticket.get("created_at")
        or ticket.get("opened_at")
    )
    if created:
        bits.append(f"opened_at={created}")
    status = str(ticket.get("status") or "").strip()
    if status:
        bits.append(f"current_status={status}")
    agent = str(
        ticket.get("assignee")
        or ticket.get("assignee_name")
        or ticket.get("assigneeName")
        or ""
    ).strip()
    resolver = str(
        ticket.get("resolver")
        or ticket.get("resolver_name")
        or ticket.get("resolverName")
        or ""
    ).strip()
    if agent:
        bits.append(f"agent={agent}")
    if resolver:
        bits.append(f"resolver={resolver}")
    subject = str(ticket.get("subject") or "").strip()
    if subject:
        bits.append(f"subject={subject}")
    if system_events:
        bits.append(f"event_count={len(system_events)}")
        last = system_events[-1]
        bits.append(f"latest_event={last.get('label')}")
    return "; ".join(bits)


def _tsaa_system_prompt(kind: str, *, issue_focused: bool = False) -> str:
    if issue_focused:
        return (
            "You are the Ticket Summary Assistant. Write ONE staff-facing "
            "Description paragraph of the customer's request — clear, readable "
            "prose from subject and description only (plus customer/channel "
            "when those fields are present). "
            "Return JSON with keys: summary (required: 2–4 sentences, plain "
            "prose, no headings), conversation, investigation, actions_taken, "
            "resolution, handover_brief (omit when empty), confidence (0-1). "
            "Cover what happened to the customer and what they want. "
            "Do not mention assignees, resolvers, queue or field edits after "
            "open, status changes, SLA, or whether notes exist. "
            "Never invent root cause, promises, other tickets, or next steps. "
            "Neutral tone. Use only the ticket fields in this turn. "
            f"summary_kind={kind}."
        )
    return (
        "You are the Ticket Summary Assistant. Write ONE overall staff-facing "
        "narrative for the ticket Description — a continuous story from opening "
        "through what just happened — using ONLY ticket, progress/history, "
        "system_events, notes, and lifecycle_hint. "
        "Return JSON with keys: summary (required: 2–5 sentences, plain prose, "
        "NO labels like 'Resolution:' or 'Handover:'), conversation, "
        "investigation, actions_taken, resolution, handover_brief (optional "
        "detail keys — omit when empty), confidence (0-1). "
        "summary MUST cover, when evidence exists: (1) why the ticket was opened "
        "(subject/description/issue), (2) who is/was assigned as agent and/or "
        "resolver, (3) notable notes or system events over the life of the "
        "ticket, (4) how long it has been open or until resolve when dates are "
        "present, (5) the current status and the latest meaningful event. "
        "Never invent root cause, promises, other tickets, or next steps. "
        "Neutral tone. Do not echo a single audit line as the whole summary. "
        f"summary_kind={kind}. "
        "created: focus on the opening request; still one narrative paragraph. "
        "resolution/reopen: rewrite the FULL lifecycle story ending with the "
        "status change — not only 'status was updated to Resolved'. "
        "handover/escalation: include prior context plus who owns it now. "
        "rolling/gap_refresh/sla/on_demand: full current-state story."
    )


def _debounced(org: str, tn: str) -> bool:
    key = f"{org}:{tn}"
    now = time.monotonic()
    prev = _last.get(key, 0.0)
    if now - prev < DEBOUNCE_S:
        return True
    _last[key] = now
    return False


def _system_events_from_progress(progress: Any) -> list[dict[str, Any]]:
    """Flatten progress history / systemEvents for the LLM (status, assign, etc.)."""
    if not isinstance(progress, dict):
        return []
    raw = (
        progress.get("systemEvents")
        or progress.get("system_events")
        or progress.get("history")
        or []
    )
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw[-40:]:
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or row.get("text") or row.get("action") or "").strip()
        if not label:
            continue
        out.append(
            {
                "at": row.get("at") or row.get("created_at") or row.get("time"),
                "label": label,
                "actor": row.get("actor") or row.get("actor_name"),
            }
        )
    return out


def _load_context(tn: str, event: dict[str, Any]) -> tuple[dict[str, Any], Any, list[Any]]:
    ticket: dict[str, Any] = {}
    progress: Any = {}
    notes: list[Any] = []
    try:
        from app.tools.ticket_read import get_ticket, get_ticket_progress, list_ticket_notes
        from app.proactive.retrieval import ticket_from_tool

        ticket = ticket_from_tool(get_ticket(tn), event.get("payload") or {})
        progress = (get_ticket_progress(tn) or {}).get("payload") or {}
        notes_raw = (list_ticket_notes(tn) or {}).get("payload") or []
        if isinstance(notes_raw, list):
            notes = notes_raw[-_NOTES_CAP:]
        elif isinstance(notes_raw, dict):
            items = notes_raw.get("items") or notes_raw.get("notes") or []
            notes = items[-_NOTES_CAP:] if isinstance(items, list) else []
    except Exception:
        ticket = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    return ticket, progress, notes


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    if not org:
        return None
    p = _payload(event)
    if p.get("skip_tsaa") or p.get("ai_summary_only"):
        return None

    et = str(event.get("event_type") or "")
    tn = _norm_tn(
        str(event.get("ticket_number") or p.get("ticket_number") or "")
    )
    if not tn:
        return None

    kind = _summary_kind(event)
    # Always summarize at create / on-demand / status lifecycle; debounce only chatter.
    if not _must_run_now(event, kind) and _debounced(org, tn):
        return None
    if _must_run_now(event, kind):
        # Refresh debounce clock so a follow-up burst still coalesces.
        _last[f"{org}:{tn}"] = time.monotonic()

    ticket, progress, notes = _load_context(tn, event)
    # Fresh create may have empty notes — still summarize subject/description.
    if et == "ticket.created" and not ticket and p:
        ticket = {
            "ticketNumber": tn,
            "subject": p.get("subject"),
            "description": p.get("description"),
        }
    # Prefer live status from the event when the GET races slightly behind.
    if p.get("new_status") and isinstance(ticket, dict):
        ticket = {
            **ticket,
            "status": p.get("new_status") or ticket.get("status"),
            "prev_status": p.get("prev_status") or ticket.get("prev_status"),
        }
    issue_focused = _issue_focused_summary(kind, et, notes)
    if issue_focused:
        issue_ticket = _issue_ticket_view(
            ticket if isinstance(ticket, dict) else {},
            tn,
            p,
        )
        user_blob = f"ticket={issue_ticket}\nevent_type={et}\n"
        prompt = _tsaa_system_prompt(kind, issue_focused=True)
    else:
        system_events = _system_events_from_progress(progress)
        status_line = (
            f"status_change={p.get('prev_status') or '?'}→{p.get('new_status') or ticket.get('status') or '?'}"
            if kind in {"resolution", "reopen"} or _truthy(p.get("statusChanged"))
            else ""
        )
        lifecycle_hint = _lifecycle_hint(
            ticket if isinstance(ticket, dict) else {},
            system_events,
        )
        user_blob = (
            f"ticket={ticket}\nprogress={progress}\nsystem_events={system_events}\n"
            f"notes={notes}\nlifecycle_hint={lifecycle_hint}\n"
            f"event_type={et}\n{status_line}"
        )
        prompt = _tsaa_system_prompt(kind, issue_focused=False)
    obj = run_agent_llm("tsaa", prompt, user_blob)
    summary = _format_summary(obj, kind)
    if not summary:
        # One retry — create/open summaries must not silently vanish on empty JSON.
        obj = run_agent_llm(
            "tsaa",
            prompt + " Reminder: summary is REQUIRED (plain sentences).",
            user_blob,
        )
        summary = _format_summary(obj, kind)
    if not summary:
        return None
    conf = confidence_of(obj, 0.65)
    if conf < SPEC.confidence_threshold:
        # Keep create/on-demand when prose exists but model omitted confidence.
        if kind in {"created", "on_demand"} and summary:
            conf = max(conf, SPEC.confidence_threshold)
        else:
            return None
    return Proposal(
        agent_id="tsaa",
        organization_id=org,
        ticket_id=str(event.get("ticket_id") or ticket.get("id") or ""),
        ticket_number=tn,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="ACTION_PROPOSAL",
        risk_level="low",
        confidence=conf,
        tool_name="update_ticket",
        tool_args={"ticket_number": tn, "ai_summary": summary},
        summary=summary,
        payload={
            "llm": obj,
            "summary_kind": kind,
            "bypass_rate_limit": kind
            in {"created", "resolution", "reopen", "on_demand", "escalation"},
        },
    )
