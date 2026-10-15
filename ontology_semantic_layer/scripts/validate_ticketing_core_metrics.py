#!/usr/bin/env python3
"""Compare 10 core ticketing metrics: MetricFlow API vs Postgres mart ground truth.

Usage:
  PYTHONPATH=. python3 scripts/validate_ticketing_core_metrics.py
  API_BASE=http://127.0.0.1:8765 ORG=1000 USER_ID=1005 TICKETING_AGENT_ID=1005 PYTHONPATH=. python3 scripts/validate_ticketing_core_metrics.py

userId must be ticketing.agents.id (not accounts.setup_users.id).
"""

from __future__ import annotations

import json
import math
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
ORG = int(os.environ.get("ORG", "1000"))
USER_ID = int(os.environ.get("USER_ID", os.environ.get("TICKETING_AGENT_ID", "1005")))
AGENT = os.environ.get("AGENT", "tk.reporting")
DRIFT = float(os.environ.get("DRIFT_TOLERANCE", "0.0001"))
MART = "ticketing_marts.mart_tickets"
OUTPUT = ROOT / "scripts" / "ticketing_core_metrics_report.json"

CORE_METRICS = [
    "ticket_volume",
    "open_tickets_metric",
    "resolved_tickets_metric",
    "unassigned_tickets_metric",
    "high_priority_ticket_volume",
    "breached_tickets_metric",
    "resolution_sla_compliance_rate",
    "sla_breach_rate",
    "assignment_rate",
    "average_resolution_time_hours",
]


def _load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip("'\""))


@dataclass
class Row:
    metric: str
    scope: str
    api_status: int
    api_value: float | None
    pg_value: float | None
    delta: float | None
    match: bool
    note: str = ""


def api_query(metric_id: str) -> tuple[int, float | None, str]:
    body = {
        "organizationId": ORG,
        "userId": USER_ID,
        "product": "ticketing",
        "agent": AGENT,
        "metrics": [metric_id],
    }
    req = urllib.request.Request(
        f"{API_BASE}/v1/semantic/query",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
            rows = data.get("rows") or []
            val = rows[0].get(metric_id) if rows else None
            if val is not None:
                val = float(val)
            return resp.status, val, ""
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read())
        except json.JSONDecodeError:
            detail = {"detail": exc.read().decode(errors="replace")}
        return exc.code, None, str(detail.get("detail", detail))
    except Exception as exc:
        return 0, None, str(exc)


def _pg_conn():
    import psycopg2

    _load_dotenv()
    return psycopg2.connect(
        host=os.environ["pg_host"],
        port=int(os.environ.get("pg_port", "5432")),
        user=os.environ.get("pg_user", "postgres"),
        password=os.environ.get("pg_pass", ""),
        dbname=os.environ.get("pg_db", "postgres"),
        connect_timeout=15,
    )


def _resolve_scope(product: str = "ticketing"):
    from semantic.scope import apply_ticketing_visible_ids, lookup_user_scope

    scope = lookup_user_scope(ORG, USER_ID, product=product)
    apply_ticketing_visible_ids(scope)
    ids = scope.visible_user_ids or []
    summary = f"role={scope.role} identity={scope.identity} visible={ids or 'org'}"
    return scope, summary


def _where_for_metric(scope, metric_id: str) -> tuple[tuple[str, list[Any]], str]:
    from semantic.lookup import get_metric_policy
    from semantic.ticketing_scope import visible_ids_for_ticketing, wants_personal_scope

    pol = get_metric_policy(metric_id, product="ticketing")
    if (pol.get("scope") or "org").lower() == "org":
        return _org_where(), "org"
    if wants_personal_scope(scope.role, user_id=scope.user_id):
        ids = visible_ids_for_ticketing(scope.user_id, scope.role) or [str(scope.user_id)]
        return _assignee_where(ids), "assignee_or_team"
    return _org_where(), "org"


def _org_where() -> tuple[str, list[Any]]:
    return "organization_id = %s", [str(ORG)]


def _assignee_where(ids: list[str]) -> tuple[str, list[Any]]:
    placeholders = ", ".join(["%s"] * len(ids))
    return (
        f"organization_id = %s AND assignee_id::text IN ({placeholders})",
        [str(ORG)] + list(ids),
    )


def _scalar(cur, sql: str, params: list[Any]) -> float | None:
    cur.execute(sql, params)
    row = cur.fetchone()
    if row is None or row[0] is None:
        return None
    return float(row[0])


def _ratio(cur, num_sql: str, den_sql: str, params: list[Any]) -> float | None:
    num = _scalar(cur, num_sql, params)
    den = _scalar(cur, den_sql, params)
    if num is None or den is None or den == 0:
        return None
    return num / den


def ground_truth(
    cur,
    metric_id: str,
    *,
    scope,
) -> tuple[float | None, str]:
    """Postgres values aligned to MetricFlow measures in semantic_layer.yml."""
    (org_w, org_p), _ = _where_for_metric(scope, metric_id)
    (asg_w, asg_p), scope_label = _where_for_metric(scope, metric_id)
    base = f"FROM {MART} WHERE"

    w, p = (asg_w, asg_p) if scope_label == "assignee_or_team" else (org_w, org_p)

    if metric_id == "ticket_volume":
        return _scalar(
            cur,
            f"SELECT COUNT(DISTINCT ticket_id) {base} {w}",
            p,
        ), scope_label

    if metric_id == "open_tickets_metric":
        return _scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE is_open) {base} {w}",
            p,
        ), scope_label

    if metric_id == "resolved_tickets_metric":
        return _scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE is_resolved) {base} {org_w}",
            org_p,
        ), "org"

    if metric_id == "unassigned_tickets_metric":
        return _scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE NOT has_assignee AND NOT is_closed) {base} {org_w}",
            org_p,
        ), "org"

    if metric_id == "high_priority_open_tickets_metric":
        return _scalar(
            cur,
            f"""SELECT COUNT(ticket_id) {base} {org_w}
                AND lower(priority) IN ('high', 'urgent')
                AND lower(status) = 'open'""",
            org_p,
        ), "org"

    if metric_id == "high_priority_ticket_volume":
        return _scalar(
            cur,
            f"""SELECT COUNT(ticket_id) {base} {w}
                AND lower(priority) IN ('high', 'urgent')""",
            p,
        ), scope_label

    if metric_id == "breached_tickets_metric":
        return _scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE is_breached_proxy) {base} {org_w}",
            org_p,
        ), "org"

    if metric_id == "resolution_sla_compliance_rate":
        # MF: resolution_sla_met_metric / tickets_with_sla_target_metric
        num = _scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE is_resolution_sla_met) {base} {org_w}",
            org_p,
        )
        den = _scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE resolution_hours_variance IS NOT NULL) {base} {org_w}",
            org_p,
        )
        if num is None or den is None or den == 0:
            return None, "org"
        return num / den, "org"

    if metric_id == "sla_breach_rate":
        num = _scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE is_breached_proxy) {base} {w}",
            p,
        )
        den = _scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE has_resolution_sla_target) {base} {w}",
            p,
        )
        if num is None or den is None or den == 0:
            return None, scope_label
        return num / den, scope_label

    if metric_id == "assignment_rate":
        assigned = _scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE has_assignee) {base} {org_w}",
            org_p,
        )
        total = _scalar(
            cur,
            f"SELECT COUNT(DISTINCT ticket_id) {base} {org_w}",
            org_p,
        )
        if assigned is None or total is None or total == 0:
            return None, "org"
        return assigned / total, "org"

    if metric_id == "average_resolution_time_hours":
        hours = _scalar(
            cur,
            f"SELECT COALESCE(SUM(resolution_hours), 0) {base} {w}",
            p,
        )
        resolved = _scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) {base} {w}",
            p,
        )
        if hours is None or resolved is None or resolved == 0:
            return None, scope_label
        return hours / resolved, scope_label

    if metric_id == "current_overdue_tickets_metric":
        return _scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE is_overdue) {base} {org_w}",
            org_p,
        ), "org"

    if metric_id == "average_csat_score":
        return _scalar(
            cur,
            f"SELECT AVG(csat_score)::float {base} {w} AND csat_score IS NOT NULL",
            p,
        ), scope_label

    raise ValueError(f"unsupported metric {metric_id}")


def _close(a: float | None, b: float | None) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if math.isnan(a) and math.isnan(b):
        return True
    return abs(a - b) <= max(DRIFT, abs(b) * 1e-6)


def main() -> int:
    _load_dotenv()
    print(f"Ticketing core metrics — API {API_BASE} org={ORG} user={USER_ID} agent={AGENT}")
    print(f"Ground truth: {MART}\n")

    scope, scope_summary = _resolve_scope()
    print(f"Scope: {scope_summary}\n")

    try:
        conn = _pg_conn()
    except Exception as exc:
        print(f"Postgres connect failed: {exc}")
        return 1

    results: list[Row] = []
    passed = failed = skipped = 0

    with conn:
        cur = conn.cursor()
        for mid in CORE_METRICS:
            status, api_val, err = api_query(mid)
            try:
                pg_val, scope_kind = ground_truth(cur, mid, scope=scope)
            except Exception as exc:
                pg_val, scope_kind = None, "?"
                err = f"pg: {exc}"

            if status != 200:
                match = False
                note = err[:120] if err else f"HTTP {status}"
                failed += 1
            elif pg_val is None and api_val is None:
                match = True
                note = "both null"
                passed += 1
            elif pg_val is None or api_val is None:
                match = False
                note = "one side null"
                failed += 1
            else:
                match = _close(api_val, pg_val)
                delta = api_val - pg_val
                note = f"delta={delta:.6g}"
                if match:
                    passed += 1
                else:
                    failed += 1

            delta = None
            if api_val is not None and pg_val is not None:
                delta = api_val - pg_val

            row = Row(
                metric=mid,
                scope=scope_kind,
                api_status=status,
                api_value=api_val,
                pg_value=pg_val,
                delta=delta,
                match=match,
                note=note,
            )
            results.append(row)
            mark = "PASS" if row.match else "FAIL"
            print(
                f"  {mark}  {mid:40s} scope={row.scope:18s} "
                f"api={row.api_value!s:>12} pg={row.pg_value!s:>12}  {row.note}"
            )

    report = {
        "api": API_BASE,
        "org": ORG,
        "user_id": USER_ID,
        "agent": AGENT,
        "scope": scope_summary,
        "mart": MART,
        "passed": passed,
        "failed": failed,
        "metrics": [r.__dict__ for r in results],
    }
    OUTPUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n{passed}/{len(CORE_METRICS)} matched. Report: {OUTPUT}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
