"""Contact Center certified KPI audit for admin (org) and agent (own).

SELECT/WITH only. Does not modify reports_analytics_agent_contact_center.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import time
from typing import Any

import yaml

from test_all_metrics_dimensions_time import (
    DEFAULT_ORG_ID,
    DSN,
    ROOT,
    TIME_WINDOWS,
    _THREAD_LOCAL,
    assert_select_only,
    audit_single_kpi,
    close_kpi_snapshot,
    cc_resolve_expression,
    cc_run_kpi,
    open_kpi_snapshot,
)
from reports_analytics_agent_contact_center.core.time import resolve_expression as cc_resolve


def discover_identities(org_id: int) -> list[dict[str, Any]]:
    snapshot = open_kpi_snapshot(DSN)
    _THREAD_LOCAL.snapshot_conn = snapshot
    try:
        from psycopg2.extras import RealDictCursor

        sql = """
        SELECT a.id, a.display_name, a.email
        FROM ccass.agents a
        WHERE a.organization_id = %s
        ORDER BY a.id
        """
        assert_select_only(sql)
        with snapshot.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (org_id,))
            people = [dict(r) for r in cur.fetchall()]
            cur.execute(
                """
                SELECT DISTINCT m.agent_id, m.queue_id
                FROM ccass.queue_members m
                JOIN ccass.queues q ON q.id = m.queue_id
                WHERE q.organization_id = %s
                ORDER BY m.agent_id, m.queue_id
                """,
                (org_id,),
            )
            memberships = [dict(r) for r in cur.fetchall()]
    finally:
        _THREAD_LOCAL.snapshot_conn = None
        close_kpi_snapshot(snapshot)

    queues_by_user: dict[int, list[int]] = {}
    for row in memberships:
        queues_by_user.setdefault(int(row["agent_id"]), []).append(int(row["queue_id"]))

    identities: list[dict[str, Any]] = []
    # Prefer the agent with queues as both admin (org) and agent (own).
    primary = None
    for p in people:
        uid = int(p["id"])
        q = queues_by_user.get(uid, [])
        if q and primary is None:
            primary = p
            identities.append({
                "user_id": uid,
                "role": "admin",
                "email": p.get("email") or "",
                "name": p.get("display_name") or "",
                "queue_ids": q,
                "scope_level": "org",
            })
            identities.append({
                "user_id": uid,
                "role": "agent",
                "email": p.get("email") or "",
                "name": p.get("display_name") or "",
                "queue_ids": q,
                "scope_level": "own",
            })
    if not identities and people:
        p = people[0]
        uid = int(p["id"])
        identities.append({
            "user_id": uid,
            "role": "admin",
            "email": p.get("email") or "",
            "name": p.get("display_name") or "",
            "queue_ids": queues_by_user.get(uid, []),
            "scope_level": "org",
        })
    return identities


def check_agent_org_denied(org_id: int, identities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    checks = []
    tb = cc_resolve("today")
    s_iso = tb.start.isoformat() if tb.start else None
    e_iso = tb.end.isoformat() if tb.end else None
    snapshot = open_kpi_snapshot(DSN)
    _THREAD_LOCAL.snapshot_conn = snapshot
    try:
        for ident in identities:
            if ident["role"] != "agent":
                continue
            res = cc_run_kpi(
                "conversation_count",
                organization_id=org_id,
                user_id=ident["user_id"],
                role="agent",
                queue_ids=ident["queue_ids"],
                scope_level="org",
                time_start=s_iso,
                time_end=e_iso,
                dsn=DSN,
            )
            checks.append({
                "user_id": ident["user_id"],
                "role": ident["role"],
                "status": res.get("status"),
                "error_type": res.get("error_type"),
                "error": res.get("error"),
                "passed": res.get("error_type") == "DENY",
            })
    finally:
        _THREAD_LOCAL.snapshot_conn = None
        close_kpi_snapshot(snapshot)
    return checks


def audit_identity(org_id, ident, kpi_defs, sql_dir, workers, quick_dim_limit):
    label = f"{ident['role']}:{ident['user_id']}"
    print(f"\n--- {label} scope={ident['scope_level']} queues={ident['queue_ids']} ---")
    started = time.time()
    out = {
        "identity": ident,
        "kpi_results": {},
        "duration_seconds": 0.0,
        "passed_kpis": 0,
        "failed_kpis": 0,
        "denied_kpis": 0,
    }
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                audit_single_kpi,
                "contact_center",
                kpi_id,
                kpi_card,
                sql_dir,
                cc_run_kpi,
                cc_resolve_expression,
                org_id,
                quick_dim_limit,
                ident["user_id"],
                ident["role"],
                ident["scope_level"],
                ident["queue_ids"],
            ): kpi_id
            for kpi_id, kpi_card in kpi_defs.items()
        }
        for future in concurrent.futures.as_completed(futures):
            kpi_id = futures[future]
            entry = future.result()
            out["kpi_results"][kpi_id] = entry
            if entry["errors"]:
                out["failed_kpis"] += 1
                print(f"  FAIL {kpi_id}: {entry['errors'][0][:140]}")
            elif entry["expected_denies"]:
                out["denied_kpis"] += 1
            else:
                out["passed_kpis"] += 1
    out["duration_seconds"] = round(time.time() - started, 2)
    print(
        f"  done {label} in {out['duration_seconds']}s | "
        f"ok={out['passed_kpis']} deny={out['denied_kpis']} fail={out['failed_kpis']}"
    )
    return out


def _fmt(val):
    if val is None:
        return "None"
    if isinstance(val, float):
        if val == int(val) and abs(val) < 1e12:
            return str(int(val))
        return f"{val:.4g}"
    return str(val)


def write_report(path, *, org_id, timestamp, duration, identities, role_runs, org_denies):
    lines = [
        "# Contact Center role warehouse test (org 1012)",
        "",
        "Certified `run_kpi` only. SELECT / WITH. `reports_analytics_agent_contact_center` was not modified.",
        "",
        f"- **When:** `{timestamp}`",
        f"- **Org:** `{org_id}`",
        f"- **Windows:** {', '.join(TIME_WINDOWS)}",
        "- **Scopes:** admin → `org`; agent → `own` (`assigned_agent_id`)",
        f"- **Duration:** `{duration}s`",
        "",
        "## Identities",
        "",
        "| Role | User ID | Name | Email | Queues | Scope |",
        "|---|---|---|---|---|---|",
    ]
    for ident in identities:
        q = ", ".join(str(x) for x in ident["queue_ids"]) or "none"
        lines.append(
            f"| {ident['role']} | `{ident['user_id']}` | {ident.get('name','')} | {ident['email']} | `{q}` | `{ident['scope_level']}` |"
        )
    lines.extend([
        "",
        "## Scoreboard",
        "",
        "| Role | User | KPIs ok | Denied | Failed | Seconds |",
        "|---|---|---|---|---|---|",
    ])
    fail_rows = []
    for run in role_runs:
        ident = run["identity"]
        lines.append(
            f"| {ident['role']} | `{ident['user_id']}` | {run['passed_kpis']} | "
            f"{run['denied_kpis']} | {run['failed_kpis']} | {run['duration_seconds']} |"
        )
        for kpi_id, entry in run["kpi_results"].items():
            for err in entry.get("errors") or []:
                fail_rows.append(f"**{ident['role']} `{ident['user_id']}` / `{kpi_id}`**: {err}")

    lines.extend([
        "",
        "## Access: agent cannot use org scope",
        "",
        "| User | Result |",
        "|---|---|",
    ])
    for c in org_denies:
        mark = "PASS (denied)" if c["passed"] else f"FAIL ({c.get('error_type')}: {c.get('error')})"
        lines.append(f"| `{c['user_id']}` | {mark} |")

    lines.extend(["", "## Failures", ""])
    if fail_rows:
        for row in fail_rows[:80]:
            lines.append(f"- {row}")
        if len(fail_rows) > 80:
            lines.append(f"- … {len(fail_rows) - 80} more")
    else:
        lines.append("No unexpected SQL failures.")

    lines.extend(["", "## Last 30 days matrix", "", "| KPI |"])
    if role_runs:
        header = "| KPI |" + "".join(
            f" {run['identity']['role'][:1].upper()}{run['identity']['user_id']} |" for run in role_runs
        )
        sep = "|---|" + "".join("---|" for _ in role_runs)
        lines[-1] = header
        lines.append(sep)
        for kpi_id in sorted(role_runs[0]["kpi_results"]):
            cells = [f"`{kpi_id}`"]
            for run in role_runs:
                entry = run["kpi_results"][kpi_id]
                last = (entry.get("baseline_by_window") or {}).get("last 30 days") or {}
                if last.get("error_type") == "DENY":
                    cells.append("deny")
                elif last.get("status") == "ok":
                    cells.append(_fmt(last.get("value")))
                else:
                    cells.append("err")
            lines.append("| " + " | ".join(cells) + " |")
    path.write_text("\n".join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--org_id", type=int, default=DEFAULT_ORG_ID)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--quick", type=int, default=None)
    args = parser.parse_args()
    pack = ROOT / "reports_analytics_agent_contact_center"
    kpi_defs = (yaml.safe_load((pack / "product" / "kpis.yml").read_text()) or {}).get("kpis") or {}
    sql_dir = pack / "product" / "sql"
    print("=" * 80)
    print("CONTACT CENTER ROLE AUDIT — SELECT / WITH")
    print("Org", args.org_id)
    print("=" * 80)
    started = time.time()
    identities = discover_identities(args.org_id)
    if not identities:
        raise SystemExit("No ccass.agents found")
    print("Users:", [(i["role"], i["user_id"]) for i in identities])
    org_denies = check_agent_org_denied(args.org_id, identities)
    role_runs = [
        audit_identity(args.org_id, ident, kpi_defs, sql_dir, args.workers, args.quick)
        for ident in identities
    ]
    duration = round(time.time() - started, 2)
    report = ROOT / "CONTACT_CENTER_ROLES_WAREHOUSE_TEST.md"
    write_report(
        report,
        org_id=args.org_id,
        timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        duration=duration,
        identities=identities,
        role_runs=role_runs,
        org_denies=org_denies,
    )
    print("Report:", report.name, duration, "s")


if __name__ == "__main__":
    main()
