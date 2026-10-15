"""
Live database snapshots + query helpers for each ticketing module.

Agents inject this text into the LLM so answers use real org data
(e.g. “how many tickets raised today?”).
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.db import fetch_all, fetch_one


def _json(obj: Any) -> str:
    return json.dumps(obj, default=str, indent=2)


def ticket_counts(
    org_id: str,
    *,
    scope: str = "org",
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
) -> dict[str, Any]:
    """Ticket status counts, optionally limited to assignee/requester scope."""
    owner_sql, owner_params = _owner_sql(
        scope, user_id=user_id, user_name=user_name, user_role=user_role
    )
    if scope in ("assignee", "requester") and not owner_sql:
        return {
            "raised_today": 0,
            "raised_this_week": 0,
            "open": 0,
            "pending": 0,
            "on_hold": 0,
            "resolved": 0,
            "overdue": 0,
            "unassigned": 0,
            "total": 0,
            "scope": scope,
        }
    row = fetch_one(
        f"""
        SELECT
          COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS raised_today,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('week', CURRENT_DATE))::int AS raised_this_week,
          COUNT(*) FILTER (WHERE status = 'Open')::int AS open,
          COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'On Hold')::int AS on_hold,
          COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved,
          COUNT(*) FILTER (WHERE status = 'Overdue')::int AS overdue,
          COUNT(*) FILTER (
            WHERE assignee_name = 'Unassigned' OR assignee_name IS NULL OR assignee_name = ''
               OR resolver_id IS NULL OR resolver_name IS NULL OR resolver_name = ''
               OR resolver_name = 'Unassigned'
          )::int AS unassigned,
          COUNT(*)::int AS total
        FROM tickets
        WHERE organization_id = %s
          {owner_sql}
        """,
        (org_id, *owner_params),
    )
    out = dict(row or {})
    out["scope"] = scope
    return out


def _owner_sql(
    scope: str,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
) -> tuple[str, tuple[Any, ...]]:
    uid = (user_id or "").strip() or None
    uname = (user_name or "").strip() or None
    if scope == "assignee":
        if not uid and not uname:
            return "", ()
        # Agent My Tickets = L1 assignee only.
        # Resolver My Tickets = L2 resolver_* (plus legacy assignee matches).
        role = (user_role or "").strip().lower()
        include_resolver = role != "agent"
        parts: list[str] = []
        params: list[Any] = []
        if uid:
            parts.append("assignee_id = %s::bigint")
            params.append(uid)
            if include_resolver:
                parts.append("resolver_id = %s::bigint")
                params.append(uid)
        if uname:
            parts.append("lower(COALESCE(assignee_name, '')) = lower(%s)")
            params.append(uname)
            if include_resolver:
                parts.append("lower(COALESCE(resolver_name, '')) = lower(%s)")
                params.append(uname)
        return f"AND ({' OR '.join(parts)})", tuple(params)
    if scope == "requester":
        if not uid:
            return "", ()
        return "AND created_by_id = %s::bigint", (uid,)
    return "", ()


def recent_tickets(
    org_id: str,
    limit: int = 8,
    *,
    scope: str = "org",
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
) -> list[dict[str, Any]]:
    owner_sql, owner_params = _owner_sql(
        scope, user_id=user_id, user_name=user_name, user_role=user_role
    )
    if scope in ("assignee", "requester") and not owner_sql:
        return []
    return fetch_all(
        f"""
        SELECT ticket_number, subject, status, priority, assignee_name,
               queue_name, customer_name, channel,
               created_at, updated_at
        FROM tickets
        WHERE organization_id = %s
          {owner_sql}
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (org_id, *owner_params, limit),
    )


def search_tickets(
    org_id: str,
    q: str,
    limit: int = 10,
    *,
    scope: str = "org",
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
) -> list[dict[str, Any]]:
    owner_sql, owner_params = _owner_sql(
        scope, user_id=user_id, user_name=user_name, user_role=user_role
    )
    if scope in ("assignee", "requester") and not owner_sql:
        return []
    pattern = f"%{q}%"
    return fetch_all(
        f"""
        SELECT ticket_number, subject, status, priority, assignee_name,
               queue_name, customer_name, channel, created_at
        FROM tickets
        WHERE organization_id = %s
          {owner_sql}
          AND (
            ticket_number ILIKE %s
            OR subject ILIKE %s
            OR description ILIKE %s
            OR customer_name ILIKE %s
            OR customer_email ILIKE %s
            OR COALESCE(queue_name, '') ILIKE %s
            OR assignee_name ILIKE %s
          )
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (
            org_id,
            *owner_params,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            pattern,
            limit,
        ),
    )


def tickets_by_priority(
    org_id: str,
    *,
    scope: str = "org",
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
) -> list[dict[str, Any]]:
    owner_sql, owner_params = _owner_sql(
        scope, user_id=user_id, user_name=user_name, user_role=user_role
    )
    if scope in ("assignee", "requester") and not owner_sql:
        return []
    return fetch_all(
        f"""
        SELECT priority, COUNT(*)::int AS count
        FROM tickets
        WHERE organization_id = %s
          AND status <> 'Resolved'
          {owner_sql}
        GROUP BY priority
        ORDER BY count DESC
        """,
        (org_id, *owner_params),
    )


def list_teams(org_id: str) -> list[dict[str, Any]]:
    """Teams from Ticketing (agent_queues + members), not MyAccount setup_teams."""
    try:
        teams = fetch_all(
            """
            SELECT id::text AS id,
                   queue_name,
                   COALESCE(description, '') AS description
            FROM agent_queues
            WHERE organization_id = %s
            ORDER BY queue_name
            """,
            (org_id,),
        )
    except Exception:
        teams = []

    try:
        member_rows = fetch_all(
            """
            SELECT queue_id::text AS queue_id, user_id::text AS user_id
            FROM agent_queue_members
            WHERE organization_id = %s
            """,
            (org_id,),
        )
    except Exception:
        member_rows = []

    members_by_q: dict[str, list[str]] = {}
    for m in member_rows:
        qid = str(m.get("queue_id") or "")
        uid = str(m.get("user_id") or "")
        if qid and uid:
            members_by_q.setdefault(qid, []).append(uid)

    # Attach open ticket counts from ticketing.tickets
    counts = {
        str(r["queue_name"]).lower(): r
        for r in fetch_all(
            """
            SELECT COALESCE(queue_name, '') AS queue_name,
                   COUNT(*) FILTER (WHERE status <> 'Resolved')::int AS open_tickets,
                   COUNT(*) FILTER (
                     WHERE status <> 'Resolved'
                       AND assignee_name IS NOT NULL
                       AND assignee_name <> ''
                       AND assignee_name <> 'Unassigned'
                   )::int AS assigned
            FROM tickets
            WHERE organization_id = %s
            GROUP BY queue_name
            """,
            (org_id,),
        )
    }
    out: list[dict[str, Any]] = []
    for t in teams:
        name = str(t.get("queue_name") or "")
        tid = str(t.get("id") or "")
        stats = counts.get(name.lower(), {})
        out.append(
            {
                "id": tid,
                "queue_name": name,
                "description": t.get("description") or "",
                "status": "active",
                "open_tickets": int(stats.get("open_tickets") or 0),
                "assigned": int(stats.get("assigned") or 0),
                "member_ids": members_by_q.get(tid, []),
            }
        )
    return out


def search_kb(org_id: str, q: str = "", limit: int = 8) -> list[dict[str, Any]]:
    if q.strip():
        pattern = f"%{q.strip()}%"
        return fetch_all(
            """
            SELECT external_id, title, category, status, views, author_name, updated_at,
                   LEFT(content, 180) AS excerpt
            FROM kb_articles
            WHERE organization_id = %s
              AND (title ILIKE %s OR content ILIKE %s OR category ILIKE %s)
            ORDER BY views DESC, updated_at DESC
            LIMIT %s
            """,
            (org_id, pattern, pattern, pattern, limit),
        )
    return fetch_all(
        """
        SELECT external_id, title, category, status, views, author_name, updated_at
        FROM kb_articles
        WHERE organization_id = %s
        ORDER BY updated_at DESC
        LIMIT %s
        """,
        (org_id, limit),
    )


def kb_counts(org_id: str) -> dict[str, Any]:
    row = fetch_one(
        """
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'Published')::int AS published,
          COUNT(*) FILTER (WHERE status = 'Draft')::int AS draft
        FROM kb_articles
        WHERE organization_id = %s
        """,
        (org_id,),
    )
    by_cat = fetch_all(
        """
        SELECT category, COUNT(*)::int AS count
        FROM kb_articles
        WHERE organization_id = %s
        GROUP BY category
        ORDER BY count DESC
        """,
        (org_id,),
    )
    return {**(row or {}), "by_category": by_cat}


_CONTACT_FROM = """
  FROM ticketing.contact_profile c
  LEFT JOIN cdp.customer_profile p
    ON p.cdp_id = c.cdp_id AND p.organization_id = c.organization_id
  LEFT JOIN LATERAL (
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id = c.cdp_id
      AND ik.organization_id = c.organization_id
      AND ik.key_type = 'email'
    LIMIT 1
  ) e ON TRUE
  LEFT JOIN LATERAL (
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.cdp_id = c.cdp_id
      AND ik.organization_id = c.organization_id
      AND ik.key_type = 'phone'
    LIMIT 1
  ) ph ON TRUE
"""


def search_customers(org_id: str, q: str = "", limit: int = 8) -> list[dict[str, Any]]:
    """Spoke contact_profile + CDP display fields (no ticketing.customers)."""
    select = f"""
        SELECT c.id::text AS id,
               NULLIF(trim(both ' ' FROM concat_ws(' ', p.first_name, p.last_name)), '') AS name,
               e.key_value AS email,
               ph.key_value AS phone,
               c.status,
               c.total_tickets,
               c.created_at
        {_CONTACT_FROM}
    """
    if q.strip():
        pattern = f"%{q.strip()}%"
        return fetch_all(
            select
            + """
            WHERE c.organization_id = %s::bigint
              AND (
                NULLIF(trim(both ' ' FROM concat_ws(' ', p.first_name, p.last_name)), '')
                  ILIKE %s
                OR COALESCE(e.key_value, '') ILIKE %s
                OR COALESCE(ph.key_value, '') ILIKE %s
              )
            ORDER BY c.total_tickets DESC, name NULLS LAST
            LIMIT %s
            """,
            (org_id, pattern, pattern, pattern, limit),
        )
    return fetch_all(
        select
        + """
        WHERE c.organization_id = %s::bigint
        ORDER BY c.total_tickets DESC, name NULLS LAST
        LIMIT %s
        """,
        (org_id, limit),
    )


def customer_counts(org_id: str) -> dict[str, Any]:
    row = fetch_one(
        """
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'Active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'Inactive')::int AS inactive
        FROM ticketing.contact_profile
        WHERE organization_id = %s::bigint
        """,
        (org_id,),
    )
    return row or {}


def recent_activity(org_id: str, limit: int = 6) -> list[dict[str, Any]]:
    return fetch_all(
        """
        SELECT text, created_at
        FROM activity_logs
        WHERE organization_id = %s
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (org_id, limit),
    )


def _extract_search_term(user_text: str) -> str | None:
    """Pull a search phrase from common ask patterns; else None."""
    text = user_text.strip()
    patterns = [
        r"(?:find|search|show|look\s*up|about|for)\s+(?:ticket|tickets|article|articles|customer|customers|team|teams|kb)?\s*[:=-]?\s*[\"']?(.+?)[\"']?$",
        r"(?:ticket|case)\s+(#?\w[\w-]*)",
        r"(?:customer|client)\s+[\"']?([A-Za-z0-9 .@_-]{2,})[\"']?",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m and m.group(1):
            term = m.group(1).strip()
            # Ignore pure intent words
            if term.lower() in {
                "today",
                "open",
                "tickets",
                "teams",
                "customers",
                "articles",
                "me",
                "all",
            }:
                continue
            if len(term) >= 2:
                return term[:80]
    return None


def count_tickets_assigned_to_user(
    org_id: str,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
    status: str | None = None,
) -> int:
    """Tickets owned by the signed-in staff member.

    Default: all non-resolved. Pass status='Open' (etc.) to narrow.
    Agents: L1 assignee_*. Resolvers: resolver_* OR legacy assignee_*.
    """
    uid = (user_id or "").strip() or None
    uname = (user_name or "").strip() or None
    if not uid and not uname:
        return 0
    include_resolver = (user_role or "").strip().lower() != "agent"
    clauses: list[str] = []
    params: list[Any] = [org_id]
    st = (status or "").strip()
    if st:
        params.append(st)
        status_sql = "AND status = %s"
    else:
        status_sql = "AND status <> 'Resolved'"
    if uid:
        clauses.append("assignee_id = %s::bigint")
        params.append(uid)
        if include_resolver:
            clauses.append("resolver_id = %s::bigint")
            params.append(uid)
    if uname:
        clauses.append("lower(COALESCE(assignee_name, '')) = lower(%s)")
        params.append(uname)
        if include_resolver:
            clauses.append("lower(COALESCE(resolver_name, '')) = lower(%s)")
            params.append(uname)
    where_owner = " OR ".join(clauses)
    rows = fetch_all(
        f"""
        SELECT COUNT(*)::int AS count
        FROM tickets
        WHERE organization_id = %s
          {status_sql}
          AND ({where_owner})
        """,
        tuple(params),
    )
    return int(rows[0]["count"]) if rows else 0


def tickets_assigned_to_user(
    org_id: str,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
    limit: int = 15,
    status: str | None = None,
) -> list[dict[str, Any]]:
    """Sample of tickets owned by the signed-in staff member (id or display name)."""
    uid = (user_id or "").strip() or None
    uname = (user_name or "").strip() or None
    if not uid and not uname:
        return []

    include_resolver = (user_role or "").strip().lower() != "agent"
    clauses: list[str] = []
    params: list[Any] = [org_id]
    st = (status or "").strip()
    if st:
        params.append(st)
        status_sql = "AND status = %s"
    else:
        status_sql = "AND status <> 'Resolved'"
    if uid:
        clauses.append("assignee_id = %s::bigint")
        params.append(uid)
        if include_resolver:
            clauses.append("resolver_id = %s::bigint")
            params.append(uid)
    if uname:
        clauses.append("lower(COALESCE(assignee_name, '')) = lower(%s)")
        params.append(uname)
        if include_resolver:
            clauses.append("lower(COALESCE(resolver_name, '')) = lower(%s)")
            params.append(uname)
    where_owner = " OR ".join(clauses)
    params.append(limit)
    return fetch_all(
        f"""
        SELECT ticket_number, subject, status, priority, assignee_name,
               queue_name, customer_name, channel, created_at
        FROM tickets
        WHERE organization_id = %s
          {status_sql}
          AND ({where_owner})
        ORDER BY
          CASE priority
            WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
            WHEN 'medium' THEN 2 ELSE 3
          END,
          created_at DESC
        LIMIT %s
        """,
        tuple(params),
    )


def _wants_my_tickets(user_text: str) -> bool:
    lower = user_text.lower()
    ticket_word = bool(re.search(r"\b(tickets?|tickes|tix|cases?)\b", lower))
    return bool(
        re.search(r"\b(my\s+tickets?|my\s+tickes|my\s+cases?|my\s+assigned)\b", lower)
        or re.search(r"\bassign?e?d\s+to\s+me\b", lower)
        or re.search(r"\bassigend\s+to\s+me\b", lower)
        or (re.search(r"\b(for|to)\s+me\b", lower) and ticket_word)
        or (re.search(r"\b(my|mine)\b", lower) and ticket_word)
        or (
            re.search(r"\bassign?e?d\b", lower)
            and ticket_word
            and re.search(r"\b(me|my)\b", lower)
        )
    )


def build_live_context(
    agent_key: str,
    org_id: str,
    user_text: str,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
) -> str:
    """
    Build a LIVE DATA block for the specialist agent.

    Ticket counts/lists follow RBAC data scope (org vs assignee vs requester).
    Customers/teams/KB/analytics blocks are omitted when the role cannot access them.
    """
    from app.rbac import can_access_module, normalize_role, ticket_data_scope

    lower = user_text.lower()
    search = _extract_search_term(user_text)
    role = normalize_role(user_role)
    scope = ticket_data_scope(role)
    scope_label = {
        "org": "organization-wide",
        "assignee": "tickets assigned to you only",
        "requester": "tickets you requested only",
    }.get(scope, scope)
    blocks: list[str] = [
        "### LIVE DATABASE RESULTS (authoritative — use these numbers)",
        f"Signed-in role={role}; ticket_data_scope={scope} ({scope_label}).",
        "INSTRUCTION: Use ONLY role-scoped ticket counts below. "
        "Never quote a larger org-wide total unless scope is organization-wide. "
        "If ACCESS DENIED appears for a module, tell the user their role cannot view that data.",
    ]

    try:
        if agent_key in ("tickets", "general"):
            counts = ticket_counts(
                org_id,
                scope=scope,
                user_id=user_id,
                user_name=user_name,
                user_role=role,
            )
            blocks.append(
                f"Ticket counts ({scope_label}):\n" + _json(counts)
            )
            blocks.append(
                "Open tickets by priority (same scope):\n"
                + _json(
                    tickets_by_priority(
                        org_id,
                        scope=scope,
                        user_id=user_id,
                        user_name=user_name,
                        user_role=role,
                    )
                )
            )
            if "today" in lower or "raised" in lower or "filed" in lower or "created" in lower:
                blocks.append(
                    f"Answer key: raised_today = {counts.get('raised_today', 0)} "
                    f"(scope={scope})"
                )
            if re.search(r"\bhow many\b", lower) and re.search(r"\bopen\b", lower):
                blocks.append(
                    f"Answer key: open = {counts.get('open', 0)} "
                    f"(scope={scope}). Reply with this open count."
                )

            # Assignee/requester roles: default samples are scoped (never org dump).
            # Explicit search still runs within the same scope.
            # Admin/viewer “for me” still loads assignee samples.
            wants_mine = _wants_my_tickets(user_text)
            use_scoped_samples = (
                scope in ("assignee", "requester") and not search
            ) or wants_mine
            if use_scoped_samples:
                open_only = bool(
                    re.search(r"\bopen\b", lower)
                    and not re.search(r"\b(all|any|every)\s+tickets?\b", lower)
                )
                if scope == "requester":
                    sample = recent_tickets(
                        org_id,
                        15,
                        scope="requester",
                        user_id=user_id,
                        user_name=user_name,
                    )
                    if open_only:
                        sample = [r for r in sample if r.get("status") == "Open"]
                    total = counts.get("open" if open_only else "total", 0)
                    blocks.append(
                        f"Tickets requested by signed-in user — TOTAL = {total} "
                        f"(sample showing {len(sample)}):\n" + _json(sample)
                    )
                else:
                    status_filter = "Open" if open_only else None
                    total_mine = count_tickets_assigned_to_user(
                        org_id,
                        user_id=user_id,
                        user_name=user_name,
                        user_role=role,
                        status=status_filter,
                    )
                    mine = tickets_assigned_to_user(
                        org_id,
                        user_id=user_id,
                        user_name=user_name,
                        user_role=role,
                        status=status_filter,
                    )
                    status_note = "Open status only" if open_only else "open/non-resolved"
                    blocks.append(
                        f"Tickets assigned to signed-in user "
                        f"(id={user_id or 'n/a'}, name={user_name or 'n/a'}) "
                        f"— TOTAL {status_note} = {total_mine} "
                        f"(sample showing {len(mine)}):\n" + _json(mine)
                    )
                    blocks.append(
                        "For assignee-scoped questions, state the TOTAL count "
                        f"({total_mine}), not the sample length. "
                        "List sample ticket_number/subject rows as examples. "
                        "If TOTAL is 0, say none are assigned (do not invent)."
                    )
            elif search:
                blocks.append(
                    f"Ticket search for “{search}” (scope={scope}):\n"
                    + _json(
                        search_tickets(
                            org_id,
                            search,
                            scope=scope,
                            user_id=user_id,
                            user_name=user_name,
                            user_role=role,
                        )
                    )
                )
            elif scope == "org":
                blocks.append(
                    "Recent tickets:\n"
                    + _json(recent_tickets(org_id, scope="org"))
                )
            else:
                blocks.append(
                    f"Recent tickets (scope={scope}):\n"
                    + _json(
                        recent_tickets(
                            org_id,
                            scope=scope,
                            user_id=user_id,
                            user_name=user_name,
                            user_role=role,
                        )
                    )
                )

        if agent_key in ("teams", "general"):
            if not can_access_module(role, "agent-queues"):
                if agent_key == "teams" or re.search(
                    r"\b(teams?|queues?)\b", lower
                ):
                    blocks.append(
                        "ACCESS DENIED: Your role cannot view teams/queues. "
                        "Do not invent team counts or names."
                    )
            else:
                teams = list_teams(org_id)
                blocks.append(f"Teams from Ticketing ({len(teams)}):\n" + _json(teams))
                if not teams:
                    blocks.append(
                        "Note: No teams configured in MyAccount for this organization."
                    )
                if search:
                    filtered = [
                        t
                        for t in teams
                        if search.lower() in str(t.get("queue_name", "")).lower()
                    ]
                    blocks.append(f"Teams matching “{search}”:\n" + _json(filtered))

        if agent_key in ("kb", "general"):
            if not can_access_module(role, "kb"):
                if agent_key == "kb" or re.search(r"\b(kb|knowledge|article)\b", lower):
                    blocks.append(
                        "ACCESS DENIED: Your role cannot view Knowledge Base. "
                        "Do not invent article counts."
                    )
            else:
                blocks.append("KB counts:\n" + _json(kb_counts(org_id)))
                if search or "article" in lower or "how to" in lower or "kb" in lower:
                    blocks.append("KB articles:\n" + _json(search_kb(org_id, search or "")))
                else:
                    blocks.append("Recent KB articles:\n" + _json(search_kb(org_id, "")))

        if agent_key in ("customers", "general"):
            if not can_access_module(role, "customers"):
                if agent_key == "customers" or re.search(r"\bcustomers?\b", lower):
                    blocks.append(
                        "ACCESS DENIED: Your role cannot view customers. "
                        "Tell the user they do not have access to the customers module."
                    )
            else:
                blocks.append("Customer counts:\n" + _json(customer_counts(org_id)))
                if search:
                    blocks.append(
                        f"Customers matching “{search}”:\n"
                        + _json(search_customers(org_id, search))
                    )
                else:
                    blocks.append(
                        "Top customers:\n" + _json(search_customers(org_id, ""))
                    )

        if agent_key == "general" and can_access_module(role, "analytics"):
            blocks.append("Recent activity:\n" + _json(recent_activity(org_id)))

    except Exception as exc:  # noqa: BLE001
        blocks.append(f"(Database error: {exc}. Tell the user data is temporarily unavailable.)")

    return "\n\n".join(blocks)
