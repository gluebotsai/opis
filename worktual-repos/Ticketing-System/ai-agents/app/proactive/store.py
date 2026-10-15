"""Recommendations, approvals, audit, routing weights, outbox (Postgres with memory fallback)."""

from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any


def _mem_id() -> str:
    """Unique in-memory id (ms timestamps collide under fast inserts)."""
    return f"mem-{uuid.uuid4().hex}"

# Min hours between repeat schedule insights (org-wide, no ticket).
_SCHEDULE_DEDUPE_HOURS: dict[str, int] = {
    "tiaa": 6,
    "wloa": 6,
    "rcaa": 24,
    "sema": 2,
}


def normalize_recommendation_summary(summary: str) -> str:
    """Collapse whitespace and lowercase for stable comparison."""
    return " ".join((summary or "").strip().lower().split())


def recommendation_dedupe_key(
    summary: str, payload: dict[str, Any] | None = None
) -> str:
    """Stable fingerprint: explicit key, else topic with numbers stripped."""
    if isinstance(payload, dict):
        explicit = str(payload.get("dedupe_key") or "").strip().lower()
        if explicit:
            return explicit
    text = normalize_recommendation_summary(summary)
    if not text:
        return ""
    text = re.sub(r"\d+", "#", text)
    for sep in (". ", " — ", " - "):
        idx = text.find(sep)
        if 0 < idx < 140:
            return text[:idx].strip()
    return text[:100]


def dedupe_hours_for_agent(agent_id: str, event_type: str | None) -> int:
    et = str(event_type or "")
    if et.startswith("schedule."):
        return _SCHEDULE_DEDUPE_HOURS.get((agent_id or "").strip().lower(), 6)
    return 24

def _use_db() -> bool:
    return os.getenv("PROACTIVE_USE_DB", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _use_api() -> bool:
    return os.getenv("PROACTIVE_VIA_API", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }

_recs: list[dict[str, Any]] = []
_approvals: list[dict[str, Any]] = []
_audit: list[dict[str, Any]] = []
_weights: dict[str, dict[str, Any]] = {}
_processed_events: set[str] = set()
_rate: list[tuple[str, str, float]] = []


def reset_memory() -> None:
    _recs.clear()
    _approvals.clear()
    _audit.clear()
    _weights.clear()
    _processed_events.clear()
    _rate.clear()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _try_db(fn, fallback):
    if not _use_db():
        return fallback()
    try:
        return fn()
    except Exception:
        return fallback()


def mark_event_processed(event_id: str, organization_id: str | None = None) -> bool:
    """Return True if this is the first time we see the event (idempotent)."""
    eid = (event_id or "").strip()
    if not eid:
        return True
    if eid in _processed_events:
        return False

    if _use_api() and organization_id:
        try:
            from app.proactive.proactive_api_client import api_mark_event_processed

            first = api_mark_event_processed(str(organization_id), eid)
            if first:
                _processed_events.add(eid)
            return first
        except Exception:
            if not _use_db():
                _processed_events.add(eid)
                return True

    def db():
        from app.db import execute_returning

        row = execute_returning(
            """
            UPDATE proactive_outbox
               SET processed_at = NOW()
             WHERE id = %s::bigint AND processed_at IS NULL
         RETURNING id
            """,
            (eid,),
        )
        if row:
            _processed_events.add(eid)
            return True
        existing = execute_returning(
            "SELECT id FROM proactive_outbox WHERE id = %s::bigint",
            (eid,),
        )
        if existing:
            return False
        _processed_events.add(eid)
        return True

    def mem():
        _processed_events.add(eid)
        return True

    return bool(_try_db(db, mem))


def insert_recommendation(row: dict[str, Any]) -> dict[str, Any]:
    rec = {
        "id": row.get("id"),
        "organization_id": row["organization_id"],
        "agent_id": row["agent_id"],
        "ticket_id": row.get("ticket_id"),
        "ticket_number": row.get("ticket_number"),
        "summary": row.get("summary") or "",
        "payload": row.get("payload") or {},
        "status": "open",
        "created_at": _now().isoformat(),
    }

    if _use_api():
        try:
            from app.proactive.proactive_api_client import api_insert_recommendation

            saved = api_insert_recommendation(rec)
            _recs.append(saved)
            return saved
        except Exception:
            if not _use_db():
                if not rec.get("id"):
                    rec["id"] = _mem_id()
                _recs.append(rec)
                return rec

    def db():
        from app.db import execute_returning
        import json

        saved = execute_returning(
            """
            INSERT INTO proactive_recommendations
              (organization_id, agent_id, ticket_id, ticket_number, summary, payload, status)
            VALUES (%s::bigint, %s, %s, %s, %s, %s::jsonb, 'open')
            RETURNING id::text AS id
            """,
            (
                rec["organization_id"],
                rec["agent_id"],
                rec.get("ticket_id"),
                rec.get("ticket_number"),
                rec["summary"],
                json.dumps(rec["payload"]),
            ),
        )
        if saved:
            rec["id"] = saved["id"]
        _recs.append(rec)
        return rec

    def mem():
        if not rec.get("id"):
            rec["id"] = _mem_id()
        _recs.append(rec)
        return rec

    return _try_db(db, mem)


def insert_approval(row: dict[str, Any]) -> dict[str, Any]:
    item = {
        "id": row.get("id"),
        "organization_id": row["organization_id"],
        "agent_id": row["agent_id"],
        "ticket_id": row.get("ticket_id"),
        "ticket_number": row.get("ticket_number"),
        "summary": row.get("summary") or "",
        "tool_name": row.get("tool_name"),
        "tool_args": row.get("tool_args") or {},
        "payload": row.get("payload") or {},
        "status": "pending",
        "created_at": _now().isoformat(),
    }

    if _use_api():
        try:
            from app.proactive.proactive_api_client import api_insert_approval

            saved = api_insert_approval(item)
            _approvals.append(saved)
            return saved
        except Exception:
            if not _use_db():
                if not item.get("id"):
                    item["id"] = _mem_id()
                _approvals.append(item)
                return item

    def db():
        from app.db import execute_returning
        import json

        saved = execute_returning(
            """
            INSERT INTO proactive_approvals
              (organization_id, agent_id, ticket_id, ticket_number, summary,
               tool_name, tool_args, payload, status)
            VALUES (%s::bigint, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, 'pending')
            RETURNING id::text AS id
            """,
            (
                item["organization_id"],
                item["agent_id"],
                item.get("ticket_id"),
                item.get("ticket_number"),
                item["summary"],
                item.get("tool_name"),
                json.dumps(item["tool_args"]),
                json.dumps(item["payload"]),
            ),
        )
        if saved:
            item["id"] = saved["id"]
        _approvals.append(item)
        return item

    def mem():
        if not item.get("id"):
            item["id"] = _mem_id()
        _approvals.append(item)
        return item

    return _try_db(db, mem)


def list_approvals(organization_id: str, *, status: str = "pending") -> list[dict[str, Any]]:
    if _use_api():
        try:
            from app.proactive.proactive_api_client import api_list_approvals

            return api_list_approvals(organization_id, status=status)
        except Exception:
            if not _use_db():
                return [
                    a
                    for a in _approvals
                    if a["organization_id"] == organization_id and a["status"] == status
                ]

    def db():
        from app.db import fetch_all

        return fetch_all(
            """
            SELECT id::text AS id, organization_id::text AS organization_id, agent_id,
                   ticket_id, ticket_number, summary, tool_name, tool_args, payload, status,
                   created_at::text AS created_at
              FROM proactive_approvals
             WHERE organization_id = %s::bigint AND status = %s
             ORDER BY created_at DESC
            """,
            (organization_id, status),
        )

    def mem():
        return [
            a
            for a in _approvals
            if a["organization_id"] == organization_id and a["status"] == status
        ]

    return list(_try_db(db, mem) or [])


def get_approval(organization_id: str, approval_id: str) -> dict[str, Any] | None:
    for a in _approvals:
        if a["id"] == approval_id and a["organization_id"] == organization_id:
            return a

    if _use_api():
        try:
            from app.proactive.proactive_api_client import api_get_approval

            return api_get_approval(organization_id, approval_id)
        except Exception:
            if not _use_db():
                return None

    def db():
        from app.db import fetch_one

        return fetch_one(
            """
            SELECT id::text AS id, organization_id::text AS organization_id, agent_id,
                   ticket_id, ticket_number, summary, tool_name, tool_args, payload, status
              FROM proactive_approvals
             WHERE organization_id = %s::bigint AND id = %s::bigint
            """,
            (organization_id, approval_id),
        )

    return _try_db(db, lambda: None)


def set_approval_status(organization_id: str, approval_id: str, status: str) -> None:
    for a in _approvals:
        if a["id"] == approval_id:
            a["status"] = status

    if _use_api():
        try:
            from app.proactive.proactive_api_client import api_set_approval_status

            api_set_approval_status(organization_id, approval_id, status)
            return
        except Exception:
            if not _use_db():
                return

    def db():
        from app.db import execute

        execute(
            """
            UPDATE proactive_approvals
               SET status = %s, decided_at = NOW()
             WHERE organization_id = %s::bigint AND id = %s::bigint
            """,
            (status, organization_id, approval_id),
        )
        return True

    _try_db(db, lambda: True)


def list_recommendations(
    organization_id: str, *, ticket_number: str | None = None
) -> list[dict[str, Any]]:
    if _use_api():
        try:
            from app.proactive.proactive_api_client import api_list_recommendations

            return api_list_recommendations(
                organization_id, ticket_number=ticket_number
            )
        except Exception:
            if not _use_db():
                rows = [r for r in _recs if r["organization_id"] == organization_id]
                if ticket_number:
                    rows = [r for r in rows if r.get("ticket_number") == ticket_number]
                return rows

    def db():
        from app.db import fetch_all

        if ticket_number:
            return fetch_all(
                """
                SELECT id::text AS id, agent_id, ticket_number, summary, payload, status,
                       created_at::text AS created_at
                  FROM proactive_recommendations
                 WHERE organization_id = %s::bigint AND ticket_number = %s
                 ORDER BY created_at DESC
                """,
                (organization_id, ticket_number),
            )
        return fetch_all(
            """
            SELECT id::text AS id, agent_id, ticket_number, summary, payload, status,
                   created_at::text AS created_at
              FROM proactive_recommendations
             WHERE organization_id = %s::bigint
             ORDER BY created_at DESC
             LIMIT 100
            """,
            (organization_id,),
        )

    def mem():
        rows = [r for r in _recs if r["organization_id"] == organization_id]
        if ticket_number:
            rows = [r for r in rows if r.get("ticket_number") == ticket_number]
        return rows

    return list(_try_db(db, mem) or [])


def recent_similar_recommendation(
    organization_id: str,
    agent_id: str,
    summary: str,
    *,
    dedupe_key: str = "",
    ticket_number: str | None = None,
    hours: int = 24,
) -> bool:
    """True when org+agent already has this insight in the dedupe window."""
    org = (organization_id or "").strip()
    agent = (agent_id or "").strip()
    summary_norm = normalize_recommendation_summary(summary)
    fingerprint = (dedupe_key or "").strip().lower() or recommendation_dedupe_key(
        summary, None
    )
    if not org or not agent or (not summary_norm and not fingerprint):
        return False

    tn = (ticket_number or "").strip()

    if _use_api():
        try:
            from app.proactive.proactive_api_client import api_recent_similar_recommendation

            if api_recent_similar_recommendation(
                org,
                agent,
                summary_norm,
                dedupe_key=fingerprint,
                ticket_number=tn or None,
                hours=hours,
            ):
                return True
        except Exception:
            pass

    def db():
        from app.db import fetch_all

        rows = fetch_all(
            """
            SELECT id::text AS id
              FROM proactive_recommendations
             WHERE organization_id = %s::bigint
               AND agent_id = %s
               AND created_at > NOW() - (%s * INTERVAL '1 hour')
               AND (%s = '' OR COALESCE(ticket_number, '') = %s)
               AND (
                     lower(regexp_replace(trim(summary), '\\s+', ' ', 'g')) = %s
                  OR (%s <> '' AND payload->>'dedupe_key' = %s)
               )
             LIMIT 1
            """,
            (org, agent, hours, tn, tn, summary_norm, fingerprint, fingerprint),
        )
        return bool(rows)

    def mem():
        cutoff = _now() - timedelta(hours=hours)
        for rec in _recs:
            if rec.get("organization_id") != org or rec.get("agent_id") != agent:
                continue
            if tn and str(rec.get("ticket_number") or "").strip() != tn:
                continue
            rec_summary = normalize_recommendation_summary(str(rec.get("summary") or ""))
            rec_payload = rec.get("payload") if isinstance(rec.get("payload"), dict) else {}
            rec_fp = str(rec_payload.get("dedupe_key") or "").strip().lower()
            if not rec_fp:
                rec_fp = recommendation_dedupe_key(rec_summary, None)
            if rec_summary != summary_norm and rec_fp != fingerprint:
                continue
            raw = rec.get("created_at")
            try:
                ts = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            except ValueError:
                continue
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts >= cutoff:
                return True
        return False

    return bool(_try_db(db, mem))


def write_audit(row: dict[str, Any]) -> None:
    item = {
        "id": _mem_id(),
        "organization_id": row.get("organization_id"),
        "agent_id": row.get("agent_id"),
        "ticket_id": row.get("ticket_id"),
        "event_id": row.get("event_id"),
        "decision": row.get("decision"),
        "reason": row.get("reason"),
        "tool_name": row.get("tool_name"),
        "created_at": _now().timestamp(),
    }
    _audit.append(item)
    _rate.append((item["agent_id"] or "", item["ticket_id"] or "", item["created_at"]))

    if _use_api() and row.get("organization_id"):
        try:
            from app.proactive.proactive_api_client import api_write_audit

            api_write_audit(row)
            return
        except Exception:
            if not _use_db():
                return

    def db():
        from app.db import execute
        import json

        execute(
            """
            INSERT INTO proactive_audit
              (organization_id, agent_id, ticket_id, event_id, decision, reason, tool_name, payload)
            VALUES (%s::bigint, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                row.get("organization_id"),
                row.get("agent_id"),
                row.get("ticket_id"),
                row.get("event_id"),
                row.get("decision"),
                row.get("reason"),
                row.get("tool_name"),
                json.dumps(row.get("payload") or {}),
            ),
        )
        return True

    _try_db(db, lambda: True)


def recent_actions_for_ticket(agent_id: str, ticket_id: str, window_s: float = 3600) -> int:
    now = _now().timestamp()
    return sum(
        1
        for a, t, ts in _rate
        if a == agent_id and t == ticket_id and now - ts < window_s
    )


def already_audited_event(
    agent_id: str, event_id: str, organization_id: str | None = None
) -> bool:
    if not event_id:
        return False
    if any(
        a.get("agent_id") == agent_id and a.get("event_id") == event_id for a in _audit
    ):
        return True
    if _use_api() and organization_id:
        try:
            from app.proactive.proactive_api_client import api_already_audited_event

            return api_already_audited_event(agent_id, event_id, organization_id)
        except Exception:
            if not _use_db():
                return False

    return False


def get_routing_weights(organization_id: str) -> dict[str, Any]:
    if organization_id in _weights:
        return _weights[organization_id]

    if _use_api():
        try:
            from app.proactive.proactive_api_client import api_get_routing_weights

            weights = api_get_routing_weights(organization_id)
            _weights[organization_id] = weights
            return weights
        except Exception:
            if not _use_db():
                return _weights.get(organization_id, {})

    def db():
        from app.db import fetch_one
        import json

        row = fetch_one(
            """
            SELECT weights FROM proactive_routing_weights
             WHERE organization_id = %s::bigint
            """,
            (organization_id,),
        )
        if not row:
            return {}
        w = row.get("weights")
        if isinstance(w, str):
            try:
                w = json.loads(w)
            except json.JSONDecodeError:
                w = {}
        return w if isinstance(w, dict) else {}

    return _try_db(db, lambda: {})


def set_routing_weights(organization_id: str, weights: dict[str, Any]) -> None:
    _weights[organization_id] = weights

    if _use_api():
        try:
            from app.proactive.proactive_api_client import api_set_routing_weights

            api_set_routing_weights(organization_id, weights)
            return
        except Exception:
            if not _use_db():
                return

    def db():
        from app.db import execute
        import json

        execute(
            """
            INSERT INTO proactive_routing_weights (organization_id, weights, updated_at)
            VALUES (%s::bigint, %s::jsonb, NOW())
            ON CONFLICT (organization_id)
            DO UPDATE SET weights = EXCLUDED.weights, updated_at = NOW()
            """,
            (organization_id, json.dumps(weights)),
        )
        return True

    _try_db(db, lambda: True)


def get_wloa_brief(organization_id: str) -> dict[str, Any]:
    """WLOA load brief ITRA may read. Same weights row as RCAA learning."""
    blob = get_routing_weights(organization_id)
    brief = blob.get("wloa_brief") if isinstance(blob, dict) else None
    return brief if isinstance(brief, dict) else {}


def set_wloa_brief(organization_id: str, brief: dict[str, Any]) -> None:
    """Merge WLOA brief without wiping RCAA skill_weights / recurring_issues."""
    prev = get_routing_weights(organization_id)
    base = dict(prev) if isinstance(prev, dict) else {}
    payload = dict(brief) if isinstance(brief, dict) else {}
    set_routing_weights(organization_id, {**base, "wloa_brief": payload})


def pending_outbox(limit: int = 25) -> list[dict[str, Any]]:
    if _use_api():
        try:
            from app.proactive.proactive_api_client import api_pending_outbox

            return api_pending_outbox(limit=limit)
        except Exception:
            if not _use_db():
                return []

    def db():
        from app.db import fetch_all

        return fetch_all(
            """
            SELECT id::text AS id, organization_id::text AS organization_id,
                   event_type, ticket_id, ticket_number, actor, payload,
                   created_at::text AS created_at
              FROM proactive_outbox
             WHERE processed_at IS NULL
             ORDER BY created_at ASC
             LIMIT %s
            """,
            (limit,),
        )

    return list(_try_db(db, lambda: []) or [])
