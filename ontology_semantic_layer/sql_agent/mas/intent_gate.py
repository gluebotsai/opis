"""Deterministic IntentKind gate + filter extract/normalize (instruction-first)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from sql_agent.errors import SqlAgentError
from sql_agent.mas.dimensions import (
    normalize_priority,
    normalize_status,
    resolve_dimension,
)
from sql_agent.mas.intent_kinds import IntentKind, is_scalar_instruction
from sql_agent.mas.metric_validator import extract_instruction_filters
from sql_agent.time_window import bounds_from_instruction


@dataclass
class GateResult:
    hint: IntentKind
    filters: list[dict[str, Any]] = field(default_factory=list)
    group_by: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    time_start: str | None = None
    time_end: str | None = None
    scope_mode: str | None = None
    team_scope: bool = False


_LIST_VERBS = re.compile(
    r"\b(list|show|get|fetch|display|browse|find|search|open up)\b",
    re.I,
)
_GROUP_BY = re.compile(
    r"\b(by|per|grouped by|breakdown by|break\s*down by)\s+"
    r"(queue_type|queue_name|queue|status_display_name|status|priority|channel|"
    r"assignee_role|assignee_name|assignee|agent|team_supports_ticketing|team|"
    r"created_by_name|created_by|creator|category|customer_name|customer|"
    r"skill|account_name|account|organization_name|organization|"
    r"resolver_name|resolver|is_overdue|overdue|has_assignee|has_resolver|"
    r"has_first_response|has_csat_rating|is_closed_by_status)\b",
    re.I,
)
_CREATED_BY_ME = re.compile(
    r"\b("
    r"created by me|"
    r"created by the current( signed[ -]?in)? user|"
    r"created by (the )?caller|"
    r"created by this user|"
    r"created by the current admin|"
    r"i created|"
    r"tickets? i (filed|opened|created)|"
    r"my created tickets|"
    r"tickets? created by (me|the current( signed[ -]?in)? user)"
    r")\b",
    re.I,
)


def is_created_by_me_instruction(instruction: str | None) -> bool:
    return bool(_CREATED_BY_ME.search(instruction or ""))
_MY_TEAM = re.compile(r"\bmy team\b", re.I)
_KPI_WORDS = re.compile(
    r"\b(rate|average|avg|aht|sla|csat|nps|metric|kpi|throughput|utilization)\b",
    re.I,
)
_ASSIGNEE_PHRASE = re.compile(
    r"\b(?:assigned to|assignee|for agent|agent)\s+([A-Za-z][A-Za-z0-9_.\- ]{1,60})",
    re.I,
)


_COUNT_PHRASE = re.compile(r"\b(how many|count of|number of)\b", re.I)
_IMPLICIT_BACKLOG = re.compile(
    r"\b("
    r"other than closed(?:\s+and\s+resolved)?"
    r"|not\s+closed"
    r"|not\s+resolved"
    r"|except\s+closed"
    r"|unresolved"
    r")\b",
    re.I,
)
_EXPLICIT_PENDING = re.compile(r"\bpending\b|\bin[\s-]?progress\b", re.I)


def hint_intent(instruction: str | None) -> IntentKind:
    """Deterministic IntentKind from instruction text alone."""
    text = (instruction or "").strip()
    if not text:
        return "list"
    if _GROUP_BY.search(text):
        return "count_grouped"
    if _COUNT_PHRASE.search(text):
        return "count_scalar"
    if _LIST_VERBS.search(text):
        return "list"
    if is_scalar_instruction(text):
        if _KPI_WORDS.search(text) and not _COUNT_PHRASE.search(text):
            return "kpi"
        return "count_scalar"
    if _KPI_WORDS.search(text):
        return "kpi"
    return "list"


def _raise_clarification(
    message: str,
    *,
    reason: str,
    missing: list[str] | None = None,
    candidates: list[str] | None = None,
) -> None:
    raise SqlAgentError(
        message,
        code="needs_clarification",
        reason=reason,
        missing=missing or [],
        candidates=candidates or [],
    )


def normalize_filters(
    raw_filters: list[dict[str, Any]],
    *,
    product: str = "ticketing",
    organization_id: int | None = None,
    resolve_assignee: bool = True,
) -> list[dict[str, Any]]:
    """Normalize filter columns/values; unknown dims → needs_clarification."""
    out: list[dict[str, Any]] = []
    for flt in raw_filters:
        col_raw = str(flt.get("column") or "")
        canonical = resolve_dimension(col_raw, product=product)
        if canonical is None:
            _raise_clarification(
                f"Unknown dimension '{col_raw}'. Use a known field (status, priority, queue, assignee).",
                reason="unknown_dimension",
                missing=[col_raw],
                candidates=sorted(
                    {
                        "status",
                        "priority",
                        "queue_name",
                        "assignee_name",
                        "channel",
                        "category",
                        "created_by_name",
                        "customer_name",
                        "skill",
                        "account_name",
                    }
                ),
            )
        values = list(flt.get("values") or [])
        op = str(flt.get("op") or "eq")
        if canonical == "status":
            if op in ("not_in", "notin", "neq_in"):
                values = [normalize_status(str(v)) for v in values]
                out.append(
                    {"column": "status", "op": "not_in", "values": values}
                )
                continue
            values = [
                resolve_status_against_org(str(v), organization_id=organization_id)
                for v in values
            ]
        elif canonical == "priority":
            values = [normalize_priority(str(v)) for v in values]
        elif canonical in ("assignee_id", "assignee_name") and resolve_assignee:
            values, canonical = _resolve_assignee_values(
                values,
                organization_id=organization_id,
                prefer_id=canonical == "assignee_id",
            )
        out.append({"column": canonical, "op": op, "values": values})
    return out


def _resolve_assignee_values(
    values: list[Any],
    *,
    organization_id: int | None,
    prefer_id: bool,
) -> tuple[list[Any], str]:
    """Map assignee name → id; 0/N matches → needs_clarification."""
    resolved: list[Any] = []
    use_id = prefer_id
    for v in values:
        s = str(v).strip()
        if not s:
            continue
        if s.isdigit():
            resolved.append(s)
            use_id = True
            continue
        matches = lookup_assignee_ids(s, organization_id=organization_id)
        if len(matches) == 0:
            resolved.append(s)
            use_id = False
            continue
        if len(matches) > 1:
            _raise_clarification(
                f"Multiple agents match '{s}'. Specify which one.",
                reason="assignee_ambiguous",
                missing=[s],
                candidates=[f"{m['id']}:{m['name']}" for m in matches[:10]],
            )
        resolved.append(matches[0]["id"])
        use_id = True
    return resolved, ("assignee_id" if use_id else "assignee_name")


def lookup_org_ticket_statuses(
    *,
    organization_id: int | None,
) -> list[dict[str, str]]:
    """Org enum list from ticketing.ticket_statuses (status + display_name)."""
    if organization_id is None:
        return []
    try:
        from sql_agent.db import run_postgres_query
    except Exception:
        return []
    sql = (
        "SELECT status, display_name "
        "FROM ticketing.ticket_statuses "
        "WHERE organization_id = %s "
        "ORDER BY status"
    )
    try:
        rows = run_postgres_query(
            sql,
            [str(organization_id)],
            schema="ticketing",
            table="ticket_statuses",
        )
    except Exception:
        return []
    out: list[dict[str, str]] = []
    for row in rows or []:
        status = str(row.get("status") or "").strip()
        if not status:
            continue
        out.append(
            {
                "status": status,
                "display_name": str(row.get("display_name") or status).strip(),
            }
        )
    return out


def _fold_status_token(value: str) -> str:
    return " ".join(str(value).strip().lower().replace("_", " ").replace("-", " ").split())


def resolve_status_against_org(
    raw: str,
    *,
    organization_id: int | None,
) -> str:
    """Map a spoken status to the org's ticket_statuses.value; no LIKE on tickets."""
    token = str(raw).strip()
    if not token:
        return token
    folded = _fold_status_token(token)
    known = lookup_org_ticket_statuses(organization_id=organization_id)
    if not known:
        return normalize_status(token)
    exact: list[str] = []
    for row in known:
        status_fold = _fold_status_token(row["status"])
        display_fold = _fold_status_token(row["display_name"])
        if folded == status_fold or folded == display_fold:
            exact.append(row["status"])
    uniq = list(dict.fromkeys(exact))
    if len(uniq) == 1:
        return uniq[0]
    if len(uniq) > 1:
        _raise_clarification(
            f"Multiple statuses match '{token}'. Specify which one.",
            reason="status_ambiguous",
            missing=[token],
            candidates=uniq[:10],
        )
    return normalize_status(token)


def lookup_assignee_ids(
    name: str,
    *,
    organization_id: int | None,
) -> list[dict[str, str]]:
    """DB lookup for ticket assignees by name (ILIKE on tickets.assignee_name)."""
    from sql_agent.ticketing_resolve import lookup_person_matches

    return lookup_person_matches(
        name_column="assignee_name",
        token=name,
        organization_id=organization_id,
    )


def extract_and_normalize_filters(
    instruction: str | None,
    *,
    product: str = "ticketing",
    organization_id: int | None = None,
) -> list[dict[str, Any]]:
    extracted = extract_instruction_filters(instruction).as_plan_filters()
    text = instruction or ""
    if _IMPLICIT_BACKLOG.search(text) and not _EXPLICIT_PENDING.search(text):
        extracted = [flt for flt in extracted if flt.get("column") != "status"]
        extracted.append(
            {
                "column": "status",
                "op": "not_in",
                "values": ["closed", "resolved"],
            }
        )
    # Assignee phrase from instruction
    m = _ASSIGNEE_PHRASE.search(text)
    if m:
        name = m.group(1).strip()
        # Trim trailing junk words
        name = re.split(r"\b(tickets?|open|pending|high|priority)\b", name, maxsplit=1)[
            0
        ].strip(" .,")
        if name:
            extracted.append(
                {"column": "assignee_name", "op": "eq", "values": [name]}
            )
    return normalize_filters(
        extracted,
        product=product,
        organization_id=organization_id,
        resolve_assignee=bool(organization_id),
    )


def run_intent_gate(
    instruction: str | None,
    *,
    product: str = "ticketing",
    organization_id: int | None = None,
) -> GateResult:
    """Full gate: IntentKind hint + normalized filters (+ group_by if breakdown)."""
    hint = hint_intent(instruction)
    group_by: list[str] = []
    m = _GROUP_BY.search(instruction or "")
    if m:
        dim = resolve_dimension(m.group(2), product=product)
        if dim is None:
            _raise_clarification(
                f"Unknown group-by dimension '{m.group(2)}'.",
                reason="unknown_dimension",
                missing=[m.group(2)],
                candidates=[
                    "queue_name",
                    "status",
                    "priority",
                    "channel",
                    "category",
                    "created_by_name",
                    "assignee_name",
                    "customer_name",
                    "skill",
                ],
            )
        # Prefer name columns for grouping
        if dim == "assignee_id":
            dim = "assignee_name"
        if dim == "queue_id":
            dim = "queue_name"
        if dim == "created_by_id":
            dim = "created_by_name"
        if dim == "customer_id":
            dim = "customer_name"
        group_by = [dim]
        hint = "count_grouped"
    filters = extract_and_normalize_filters(
        instruction,
        product=product,
        organization_id=organization_id,
    )
    time_start, time_end = bounds_from_instruction(instruction)
    scope_mode = None
    team_scope = bool(_MY_TEAM.search(instruction or ""))
    if is_created_by_me_instruction(instruction):
        scope_mode = "created_by"
        hint = "count_scalar" if hint == "list" and is_scalar_instruction(instruction) else hint
        if is_scalar_instruction(instruction) and hint != "count_grouped":
            hint = "count_scalar"
    return GateResult(
        hint=hint,
        filters=filters,
        group_by=group_by,
        time_start=time_start,
        time_end=time_end,
        scope_mode=scope_mode,
        team_scope=team_scope,
    )
