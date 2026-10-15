"""Ticketing warehouse audit for every live admin, agent, and resolver in an org.

SELECT / WITH only. Does not modify reports_analytics_agent_ticketing_v2.
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
    open_kpi_snapshot,
    t_resolve_expression,
    t_run_kpi,
)
from reports_analytics_agent_ticketing_v2.core.time import resolve_expression as t_resolve

assert_select_only  # re-export used by patched fetchall


def discover_ticketing_identities(org_id: int) -> list[dict[str, Any]]:
    """Load Active staff from ticketing.agents plus their queue memberships."""
    snapshot = open_kpi_snapshot(DSN)
    _THREAD_LOCAL.snapshot_conn = snapshot
    try:
        from psycopg2.extras import RealDictCursor

        sql = """
        SELECT a.id, a.role, a.status, a.support_email
        FROM ticketing.agents a
        WHERE a.organization_id = %s
          AND COALESCE(a.status, 'Active') ILIKE 'active'
        ORDER BY a.role, a.id
        """
        assert_select_only(sql)
        with snapshot.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (org_id,))
            people = [dict(r) for r in cur.fetchall()]
            cur.execute(
                """
                SELECT user_id, queue_id
                FROM ticketing.agent_queue_members
                WHERE organization_id = %s
                ORDER BY user_id, queue_id
                """,
                (org_id,),
            )
            memberships = [dict(r) for r in cur.fetchall()]
    finally:
        _THREAD_LOCAL.snapshot_conn = None
        close_kpi_snapshot(snapshot)

    queues_by_user: dict[int, list[int]] = {}
    for row in memberships:
        queues_by_user.setdefault(int(row["user_id"]), []).append(int(row["queue_id"]))

    identities = []
    for person in people:
        role = str(person["role"]).strip().lower()
        if role not in {"admin", "agent", "resolver"}:
            continue
        user_id = int(person["id"])
        identities.append({
            "user_id": user_id,
            "role": role,
            "email": person.get("support_email") or "",
            "queue_ids": queues_by_user.get(user_id, []),
            "scope_level": "org" if role == "admin" else "own",
        })
    return identities


def check_org_scope_denied(org_id: int, identities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Agent and resolver must be denied org-wide ticket_count."""
    checks = []
    tb = t_resolve("today")
    s_iso = tb.start.isoformat() if tb.start else None
    e_iso = tb.end.isoformat() if tb.end else None
    snapshot = open_kpi_snapshot(DSN)
    _THREAD_LOCAL.snapshot_conn = snapshot
    try:
        for ident in identities:
            if ident["role"] == "admin":
                continue
            res = t_run_kpi(
                "ticket_count",
                organization_id=org_id,
                user_id=ident["user_id"],
                role=ident["role"],
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


def audit_identity(
    org_id: int,
    ident: dict[str, Any],
    kpi_defs: dict[str, Any],
    sql_dir,
    workers: int,
    quick_dim_limit: int | None,
) -> dict[str, Any]:
    label = f"{ident['role']}:{ident['user_id']}"
    print(f"\n--- {label}  scope={ident['scope_level']}  queues={ident['queue_ids']} ---")
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
                "ticketing",
                kpi_id,
                kpi_card,
                sql_dir,
                t_run_kpi,
                t_resolve_expression,
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
                print(f"  FAIL {kpi_id}: {entry['errors'][0][:120]}")
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


def _fmt(val: Any) -> str:
    if val is None:
        return "None"
    if isinstance(val, float):
        if val == int(val) and abs(val) < 1e12:
            return str(int(val))
        return f"{val:.4g}"
    return str(val)


def write_ticketing_roles_report(
    path,
    *,
    org_id: int,
    timestamp: str,
    duration: float,
    identities: list[dict[str, Any]],
    role_runs: list[dict[str, Any]],
    org_denies: list[dict[str, Any]],
) -> None:
    lines = [
        "# Ticketing role warehouse test (org 1012)",
        "",
        "Certified `run_kpi` only. Every statement is `SELECT` / `WITH`. "
        "`reports_analytics_agent_ticketing_v2` was not modified.",
        "",
        "## Setup",
        "",
        f"- **When:** `{timestamp}`",
        f"- **Org:** `{org_id}`",
        f"- **Windows:** {', '.join(TIME_WINDOWS)} (UTC)",
        "- **Scopes:** admin → `org`; agent → `own` (`assignee_id`); resolver → `own` (`resolver_id`)",
        f"- **Duration:** `{duration}s`",
        "",
        "## Identities tested",
        "",
        "| Role | User ID | Email | Queues | Default scope |",
        "|---|---|---|---|---|",
    ]
    for ident in identities:
        q = ", ".join(str(x) for x in ident["queue_ids"]) or "none"
        lines.append(
            f"| {ident['role']} | `{ident['user_id']}` | {ident['email']} | `{q}` | `{ident['scope_level']}` |"
        )

    lines.extend([
        "",
        "## Scoreboard by user",
        "",
        "| Role | User | KPIs ok | KPIs denied (allowed) | KPIs failed | Seconds |",
        "|---|---|---|---|---|---|",
    ])
    total_fail = 0
    for run in role_runs:
        ident = run["identity"]
        total_fail += run["failed_kpis"]
        lines.append(
            f"| {ident['role']} | `{ident['user_id']}` | {run['passed_kpis']} | "
            f"{run['denied_kpis']} | {run['failed_kpis']} | {run['duration_seconds']} |"
        )

    lines.extend([
        "",
        "## Access check: agent/resolver cannot use org scope",
        "",
        "`ticket_count` with `scope_level=org` must return `error_type=DENY`.",
        "",
        "| Role | User | Result |",
        "|---|---|---|",
    ])
    for c in org_denies:
        mark = "PASS (denied)" if c["passed"] else f"FAIL ({c.get('error_type')}: {c.get('error')})"
        lines.append(f"| {c['role']} | `{c['user_id']}` | {mark} |")

    lines.extend(["", "## What is good", ""])
    lines.append("- Every Active admin, agent, and resolver in org 1012 was loaded from `ticketing.agents` (SELECT).")
    lines.append("- Admin ran at org scope. Agents and resolvers ran at own scope, which is their default in `access.yml`.")
    if all(c["passed"] for c in org_denies) and org_denies:
        lines.append("- Org-wide `ticket_count` is denied for every agent and resolver (matrix `org.agent` / `org.resolver` = deny).")
    if total_fail == 0:
        lines.append("- No unexpected SQL / timeout failures on this role pass.")
    else:
        lines.append(f"- Unexpected failures: **{total_fail}** KPI×user combinations (see below).")
    lines.append("- Workforce KPIs that only allow `org` correctly DENY for agent/resolver own-scope; that is catalog access, not a broken query.")
    lines.append("")

    lines.extend(["## What is not good", ""])
    fail_rows = []
    for run in role_runs:
        ident = run["identity"]
        for kpi_id, entry in run["kpi_results"].items():
            for err in entry.get("errors") or []:
                fail_rows.append(f"**{ident['role']} `{ident['user_id']}` / `{kpi_id}`**: {err}")
    if fail_rows:
        for row in fail_rows:
            lines.append(f"- {row}")
    else:
        lines.append("- No unexpected query failures. Remaining gaps are YAML-only dimensions (no SQL slots) and org-only KPIs denied for non-admins.")
    lines.append("")

    lines.extend(["## Issues, why, how to fix", ""])
    if fail_rows:
        lines.append("### Unexpected SQL or timeout")
        lines.append("")
        lines.append(
            "**Why:** Same class as the admin org run (for example `assignment_rate` correlated `EXISTS` on `audit_events` with `ticket_id::text`). "
            "Own-scope is a smaller set, so some timeouts may disappear."
        )
        lines.append("")
        lines.append(
            "**Fix:** Qualify joins on native bigint ids and index `(organization_id, action, ticket_id)`. "
            "Do not raise statement timeout as the first fix. Product folder changes are out of this test’s scope."
        )
        lines.append("")
    lines.append("### Org-only KPIs denied for agent and resolver")
    lines.append("")
    lines.append(
        "**Why:** `kpis.yml` `allowed_scope_levels` is often `[org]` for workforce/catalog metrics "
        "(`active_agents`, `queue_count`, `total_users`, KB, AI counts, …). Agent/resolver default scope is `own`, "
        "so `run_kpi` returns `scope_denied`. That matches `access.yml`."
    )
    lines.append("")
    lines.append(
        "**Fix:** If L1/L2 should see those metrics on their own tickets or queues, add `own` / `queue` to "
        "`allowed_scope_levels` and confirm the SQL has `{{scope_sql}}` on the right column. If they must not see them, keep the deny."
    )
    lines.append("")
    lines.append("### YAML dimensions with no grouping slots")
    lines.append("")
    lines.append(
        "`note_count`, `escalation_count`, `reassignment_count`, `kb_article_count` still list dimensions the `.sql` files cannot group. "
        "Add slots in the templates or drop the dimensions from YAML."
    )
    lines.append("")

    lines.extend([
        "## Per-user KPI matrix (last 30 days)",
        "",
        "Value is the ungrouped baseline for **last 30 days**. `deny` means access/catalog denied. `err` means SQL/timeout.",
        "",
    ])

    kpi_ids = sorted(role_runs[0]["kpi_results"].keys()) if role_runs else []
    header = "| KPI |" + "".join(
        f" {run['identity']['role'][:1].upper()}{run['identity']['user_id']} |" for run in role_runs
    )
    sep = "|---|" + "".join("---|" for _ in role_runs)
    lines.append(header)
    lines.append(sep)
    for kpi_id in kpi_ids:
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

    lines.extend([
        "",
        "## Four-window baselines (each user)",
        "",
    ])
    for run in role_runs:
        ident = run["identity"]
        lines.append(f"### {ident['role']} `{ident['user_id']}` ({ident['email']})")
        lines.append("")
        lines.append("| KPI | Today | This week | Last 7d | Last 30d | Status |")
        lines.append("|---|---|---|---|---|---|")
        for kpi_id in sorted(run["kpi_results"]):
            k = run["kpi_results"][kpi_id]
            b = k["baseline_by_window"]

            def cell(win: str) -> str:
                info = b.get(win) or {}
                if info.get("error_type") == "DENY":
                    return "deny"
                if info.get("status") == "ok":
                    return _fmt(info.get("value"))
                if info.get("status") == "error":
                    return "err"
                return "-"

            if k["errors"]:
                st = f"{len(k['errors'])} err"
            elif k["expected_denies"]:
                st = "deny"
            else:
                st = "ok"
            lines.append(
                f"| `{kpi_id}` | {cell('today')} | {cell('this week')} | "
                f"{cell('last 7 days')} | {cell('last 30 days')} | {st} |"
            )
        lines.append("")

    lines.extend([
        "## How to re-run",
        "",
        "```bash",
        "/home/vectone/miniconda3/bin/python test_ticketing_roles.py --org_id 1012",
        "```",
        "",
    ])
    path.write_text("\n".join(lines))


def main() -> None:
    parser = argparse.ArgumentParser(description="Ticketing KPI audit for all admin/agent/resolver users.")
    parser.add_argument("--org_id", type=int, default=DEFAULT_ORG_ID)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--quick", type=int, default=None)
    args = parser.parse_args()

    pack_root = ROOT / "reports_analytics_agent_ticketing_v2"
    kpi_defs = (yaml.safe_load((pack_root / "product" / "kpis.yml").read_text()) or {}).get("kpis") or {}
    sql_dir = pack_root / "product" / "sql"

    print("=" * 80)
    print("TICKETING ROLE AUDIT — SELECT / WITH only")
    print(f"Org {args.org_id}  windows={TIME_WINDOWS}")
    print("=" * 80)

    started = time.time()
    identities = discover_ticketing_identities(args.org_id)
    if not identities:
        raise SystemExit(f"No Active admin/agent/resolver users found for org {args.org_id}")
    print("Users:", [(i["role"], i["user_id"]) for i in identities])

    org_denies = check_org_scope_denied(args.org_id, identities)
    role_runs = [
        audit_identity(args.org_id, ident, kpi_defs, sql_dir, args.workers, args.quick)
        for ident in identities
    ]

    duration = round(time.time() - started, 2)
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    report_path = ROOT / "TICKETING_ROLES_WAREHOUSE_TEST.md"
    write_ticketing_roles_report(
        report_path,
        org_id=args.org_id,
        timestamp=timestamp,
        duration=duration,
        identities=identities,
        role_runs=role_runs,
        org_denies=org_denies,
    )
    print(f"\nReport: {report_path.name}  ({duration}s)")


if __name__ == "__main__":
    main()
