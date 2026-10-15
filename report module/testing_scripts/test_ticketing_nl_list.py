"""Natural-language list/find tests for ticketing (admin, agent, resolver).

Does not modify reports_analytics_agent_ticketing_v2.
SELECT / WITH only. Domain plan + SQL executor + guarded run_sql (one repair).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import httpx
import yaml
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

ROOT = Path(__file__).resolve().parent
PACK = ROOT / "reports_analytics_agent_ticketing_v2"
sys.path.insert(0, str(ROOT))

for env_path in [ROOT / ".env", PACK / ".env", Path("/home/vectone/shiva/reportagent/.env")]:
    if env_path.exists():
        load_dotenv(env_path)

from test_all_metrics_dimensions_time import (  # noqa: E402
    DSN,
    assert_select_only,
    close_kpi_snapshot,
    open_kpi_snapshot,
    _THREAD_LOCAL,
)

import reports_analytics_agent_ticketing_v2.core.db as t_db  # noqa: E402
from reports_analytics_agent_ticketing_v2.core.examples import (  # noqa: E402
    format_examples_for_prompt,
    load_examples,
    pick_examples,
)
from reports_analytics_agent_ticketing_v2.core.run_sql import run_sql  # noqa: E402
from reports_analytics_agent_ticketing_v2.core.time import TimeBounds, resolve_expression  # noqa: E402

LLM_BASE = os.getenv("SQL_AGENT_LLM_URL", os.getenv("LLM_BASE_URL", "http://173.234.75.166:8011/v1")).rstrip("/")
LLM_MODEL = os.getenv("SQL_AGENT_LLM_MODEL", os.getenv("LLM_MODEL_NAME", "worktual-gemma"))

# One live user per role (org 1012).
IDENTITIES = [
    {"role": "admin", "user_id": 1033, "queue_ids": []},
    {"role": "agent", "user_id": 1034, "queue_ids": [1061, 1062, 1063, 1065, 1066]},
    {"role": "resolver", "user_id": 1035, "queue_ids": [1063, 1065, 1066]},
]


def safe_fetchall(dsn: str, sql: str, params: Any = (), *, timeout_ms: int = 20000) -> list[dict[str, Any]]:
    assert_select_only(sql)
    conn = open_kpi_snapshot(dsn)
    _THREAD_LOCAL.snapshot_conn = conn
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"SET statement_timeout = {int(timeout_ms)}")
            if params:
                cur.execute(sql, params)
            else:
                cur.execute(sql)
            return [dict(r) for r in cur.fetchall()]
    finally:
        _THREAD_LOCAL.snapshot_conn = None
        close_kpi_snapshot(conn)


t_db.fetchall = safe_fetchall


def call_llm(messages: list[dict[str, str]], temperature: float = 0.1, max_tokens: int = 700) -> str:
    client = httpx.Client(base_url=LLM_BASE, timeout=60.0)
    resp = client.post(
        "/chat/completions",
        json={"model": LLM_MODEL, "messages": messages, "temperature": temperature, "max_tokens": max_tokens},
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def extract_json(text: str) -> dict[str, Any]:
    clean = text.strip()
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", clean, re.DOTALL)
    if match:
        clean = match.group(1)
    elif "{" in clean and "}" in clean:
        clean = clean[clean.find("{") : clean.rfind("}") + 1]
    try:
        return json.loads(clean)
    except Exception:
        return {}


def extract_sql_query(text: str) -> str:
    parsed = extract_json(text.strip())
    if parsed and "sql" in parsed:
        return str(parsed["sql"]).strip().rstrip(";")
    m_sql = re.search(r"```(?:sql)?\s*(SELECT\b.*?|WITH\b.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if m_sql:
        return m_sql.group(1).strip().rstrip(";")
    m_raw = re.search(r"\b(SELECT\b.*?|WITH\b.*?)(?:;|\Z)", text, re.DOTALL | re.IGNORECASE)
    if m_raw:
        return m_raw.group(1).strip().rstrip(";")
    return text.strip().rstrip(";")


def load_views_summary() -> str:
    schema = yaml.safe_load((PACK / "product" / "schema.yml").read_text()) or {}
    lines = ["## Available rpt.* Virtual Views and Key Columns:"]
    for v_name, v_conf in (schema.get("views") or {}).items():
        desc = str(v_conf.get("description", "")).split("\n")[0].strip()
        lines.append(f"\n### rpt.{v_name} ({desc}):")
        for cname, cmeta in (v_conf.get("columns") or {}).items():
            if isinstance(cmeta, dict) and cmeta.get("description"):
                lines.append(f"  - `{cname}`: {cmeta['description'].split('.')[0].strip()}")
            else:
                lines.append(f"  - `{cname}`")
    return "\n".join(lines)


def discover_labels(org_id: int, ident: dict[str, Any]) -> dict[str, str]:
    """Pick a team name this user can see and a customer name from their tickets."""
    labels = {"team_name": "Product Support", "customer_name": ""}
    qids = ident["queue_ids"]
    conn = open_kpi_snapshot(DSN)
    _THREAD_LOCAL.snapshot_conn = conn
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SET statement_timeout = 10000")
            if ident["role"] == "admin":
                cur.execute(
                    "SELECT queue_name FROM ticketing.agent_queues WHERE organization_id = %s ORDER BY id LIMIT 1",
                    (org_id,),
                )
            elif qids:
                cur.execute(
                    "SELECT queue_name FROM ticketing.agent_queues WHERE organization_id = %s AND id = ANY(%s) ORDER BY id LIMIT 1",
                    (org_id, qids),
                )
            row = cur.fetchone()
            if row and row.get("queue_name"):
                labels["team_name"] = str(row["queue_name"])
            if ident["role"] == "admin":
                cur.execute(
                    """
                    SELECT customer_name FROM ticketing.tickets
                    WHERE organization_id = %s AND customer_name IS NOT NULL AND customer_name <> ''
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (org_id,),
                )
            elif ident["role"] == "agent":
                cur.execute(
                    """
                    SELECT customer_name FROM ticketing.tickets
                    WHERE organization_id = %s AND assignee_id = %s
                      AND customer_name IS NOT NULL AND customer_name <> ''
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (org_id, ident["user_id"]),
                )
            else:
                cur.execute(
                    """
                    SELECT customer_name FROM ticketing.tickets
                    WHERE organization_id = %s AND resolver_id = %s
                      AND customer_name IS NOT NULL AND customer_name <> ''
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (org_id, ident["user_id"]),
                )
            crow = cur.fetchone()
            if crow and crow.get("customer_name"):
                labels["customer_name"] = str(crow["customer_name"])
    finally:
        _THREAD_LOCAL.snapshot_conn = None
        close_kpi_snapshot(conn)
    return labels


def questions_for(labels: dict[str, str]) -> list[dict[str, Any]]:
    team = labels["team_name"]
    cust = labels["customer_name"] or "the customer"
    return [
        {"id": "list_my_tickets", "q": "List my tickets", "kind": "ticket_list", "expect": "my_tickets"},
        {"id": "list_open", "q": "List open tickets", "kind": "ticket_list", "expect": "status_open"},
        {"id": "list_high_priority", "q": "List high priority tickets", "kind": "ticket_list", "expect": "priority"},
        {"id": "list_today", "q": "List tickets created today", "kind": "ticket_list", "expect": "dated"},
        {"id": "list_last_7_days", "q": "List tickets created in the last 7 days", "kind": "ticket_list", "expect": "dated"},
        {"id": "list_created_by_me", "q": "List tickets I created", "kind": "ticket_list", "expect": "created_by_me"},
        {"id": "list_unassigned", "q": "List unassigned tickets", "kind": "ticket_list", "expect": "unassigned"},
        {"id": "list_customers", "q": "List customers", "kind": "customer_list", "expect": "customers"},
        {"id": "find_customer", "q": f"Find customer {cust}", "kind": "customer_list", "expect": "customers"},
        {"id": "list_statuses", "q": "List all ticket statuses", "kind": "distinct", "expect": "status"},
        {"id": "list_priorities", "q": "List all ticket priorities", "kind": "distinct", "expect": "priority"},
        {"id": "list_teams", "q": "List teams", "kind": "team_list", "expect": "queues"},
        {"id": "find_team", "q": f"Find the team named {team}", "kind": "team_list", "expect": "queues"},
        {"id": "team_members", "q": f"Who are the members of {team}?", "kind": "members", "expect": "members"},
        {"id": "list_pending", "q": "List pending tickets", "kind": "ticket_list", "expect": "status_pending"},
    ]


def judge_rows(ident: dict[str, Any], spec: dict[str, Any], rows: list[dict[str, Any]], sql: str) -> list[str]:
    """Access / shape checks. Empty result is allowed (no matching rows)."""
    issues: list[str] = []
    role = ident["role"]
    uid = ident["user_id"]
    sql_l = (sql or "").lower()
    if sql and not (sql.strip().lower().startswith("select") or sql.strip().lower().startswith("with")):
        issues.append("compiled SQL is not SELECT/WITH")
    if rows and spec["kind"] == "ticket_list":
        sample = rows[0]
        if role == "resolver" and "resolver_id" in sample:
            foreign = [
                r for r in rows
                if r.get("resolver_id") is not None and int(r["resolver_id"]) != uid
            ]
            if foreign:
                issues.append("resolver saw tickets with another resolver_id")
        if spec["expect"] == "my_tickets" and role == "agent" and "assignee_id" in sample:
            foreign = [r for r in rows if r.get("assignee_id") not in (None, uid) and int(r["assignee_id"]) != uid]
            if foreign:
                issues.append("agent 'my tickets' included other assignees")
        if spec["expect"] == "unassigned" and "assignee_id" in sample:
            assigned = [r for r in rows if r.get("assignee_id") not in (None,)]
            if assigned:
                issues.append("unassigned list contained assignee_id values")
    if spec["kind"] == "customer_list" and role == "resolver" and "rpt.customers" in sql_l:
        issues.append("resolver SQL targeted rpt.customers (view not granted)")
    return issues


def run_turn(
    *,
    org_id: int,
    ident: dict[str, Any],
    question: str,
    domain_prompt: str,
    sql_prompt: str,
    views_summary: str,
    sql_examples: list,
) -> dict[str, Any]:
    role = ident["role"]
    user_id = ident["user_id"]
    queue_ids = ident["queue_ids"]
    domain_user = f"Identity: role={role}, org_id={org_id}, user_id={user_id}, queues={queue_ids}\nQuestion: {question}"
    plan = {"tasks": []}
    err = None
    try:
        domain_raw = call_llm(
            [{"role": "system", "content": domain_prompt}, {"role": "user", "content": domain_user}],
        )
        plan = extract_json(domain_raw) or {}
    except Exception as exc:
        err = f"domain: {exc}"
        return {"status": "error", "error": err, "plan": plan, "sql": "", "rows": [], "kpi": None}

    tasks = plan.get("tasks") or [{
        "id": "t1",
        "executor": "sql",
        "kpi": None,
        "goal": question,
        "time": "last 7 days",
        "scope": "org" if role == "admin" else "own",
        "answer_type": "list",
    }]
    all_rows: list[dict[str, Any]] = []
    last_sql = ""
    last_kpi = None
    last_error = None
    for task in tasks:
        if task.get("executor") == "kg":
            last_error = "kg_executor_skipped_use_sql_for_lists"
            continue
        last_kpi = task.get("kpi")
        time_expr = task.get("time") or "last 7 days"
        try:
            tb = resolve_expression(time_expr)
        except Exception:
            tb = TimeBounds(None, None, "overall")
        start_iso = tb.start.isoformat() if tb.start else None
        end_iso = tb.end.isoformat() if tb.end else None
        query_params = {"start": start_iso, "end": end_iso} if start_iso and end_iso else {}
        time_ctx = (
            f"time_params: start={start_iso}, end={end_iso}\nparams_available: :start, :end"
            if query_params
            else "time_params: overall / all-time\nparams_available: none"
        )
        goal = task.get("goal") or question
        chosen = pick_examples(goal, sql_examples, top_k=6, kind="sql")
        few = format_examples_for_prompt(chosen, kind="sql") if chosen else ""
        prompt = f"{sql_prompt}\n\n{views_summary}\n\n## Few-Shot SQL Examples\n{few}"
        sql_user = (
            f"Task Goal: {goal}\n{time_ctx}\nscope: {task.get('scope', 'own')}\n"
            f"answer_type: {task.get('answer_type', 'list')}\n"
            "Write a SELECT against rpt.* that lists the requested rows. Do not invent tables."
        )
        try:
            sql_raw = call_llm([{"role": "system", "content": prompt}, {"role": "user", "content": sql_user}])
            sql_query = extract_sql_query(sql_raw)
            last_sql = sql_query
            result = run_sql(
                sql_query,
                organization_id=org_id,
                user_id=user_id,
                role=role,
                queue_ids=queue_ids,
                params=query_params,
                dsn=DSN,
            )
            if result.get("status") == "error":
                repair_msg = (
                    f"Task Goal: {goal}\n{time_ctx}\nPrevious SQL:\n```sql\n{sql_query}\n```\n"
                    f"Database Error: {result.get('error')}\n"
                    "Rewrite using only valid rpt.* views and columns."
                )
                repair_raw = call_llm([{"role": "system", "content": prompt}, {"role": "user", "content": repair_msg}])
                sql_query = extract_sql_query(repair_raw)
                last_sql = sql_query
                result = run_sql(
                    sql_query,
                    organization_id=org_id,
                    user_id=user_id,
                    role=role,
                    queue_ids=queue_ids,
                    params=query_params,
                    dsn=DSN,
                )
            if result.get("status") == "ok":
                all_rows.extend(result.get("rows") or [])
                last_error = None
            else:
                last_error = result.get("error") or result.get("error_type")
        except Exception as exc:
            last_error = str(exc)
    status = "ok" if last_error is None else "error"
    if last_error == "kg_executor_skipped_use_sql_for_lists" and all_rows:
        status = "ok"
        last_error = None
    return {
        "status": status,
        "error": last_error,
        "plan": plan,
        "sql": last_sql,
        "rows": all_rows[:50],
        "row_count": len(all_rows),
        "kpi": last_kpi,
        "scope_planned": (tasks[0].get("scope") if tasks else None),
    }


def write_report(path: Path, org_id: int, results: list[dict[str, Any]], duration: float) -> None:
    ok = sum(1 for r in results if r["verdict"] == "pass")
    fail = sum(1 for r in results if r["verdict"] == "fail")
    warn = sum(1 for r in results if r["verdict"] == "warn")
    lines = [
        "# Ticketing natural-language list / find test",
        "",
        "Headless Domain + SQL executor against live org 1012. Agent folders were not edited. SELECT/WITH only.",
        "",
        f"- **Duration:** `{duration}s`",
        f"- **Turns:** {len(results)} (15 questions × 3 roles)",
        f"- **Pass / warn / fail:** {ok} / {warn} / {fail}",
        "",
        "## What we asked",
        "",
        "List/find scenarios: my tickets, open, high priority, today, last 7 days, tickets I created, unassigned, customers, find a customer, statuses, priorities, teams, find a team by name, team members, pending tickets.",
        "",
        "Access expectation: sql_guard scopes `rpt.tickets` so admin can see the org; agent sees own/created/queue tickets; resolver sees `resolver_id = me`. Extra filters like “my tickets” / unassigned should appear in the LLM SQL.",
        "",
        "## Results",
        "",
        "| Role | User | Scenario | Question | Rows | Verdict | Notes |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in results:
        qshort = r["question"].replace("|", "/")[:70]
        notes = r["notes"].replace("|", "/")[:80]
        lines.append(
            f"| {r['role']} | `{r['user_id']}` | `{r['id']}` | {qshort} | {r['row_count']} | {r['verdict']} | {notes} |"
        )
    fails = [r for r in results if r["verdict"] == "fail"]
    lines.extend(["", "## Failures (why / how to fix)", ""])
    if not fails:
        lines.append("No failed turns.")
    for r in fails:
        lines.append(f"### {r['role']} `{r['user_id']}` / `{r['id']}`")
        lines.append("")
        lines.append(f"**Question:** {r['question']}")
        lines.append("")
        lines.append(f"**Why:** {r['notes']}")
        lines.append("")
        if r.get("sql"):
            lines.append("```sql")
            lines.append(r["sql"][:800])
            lines.append("```")
            lines.append("")
        lines.append(
            "**Fix:** Adjust Domain/SQL examples so list questions use `run_sql` on `rpt.tickets` / `rpt.customers` / `rpt.queues` / `rpt.queue_members`, not a certified KPI count. Keep role scope in the plan (`org` vs `own` vs `created_by_me`)."
        )
        lines.append("")
    lines.extend([
        "## How to re-run",
        "",
        "```bash",
        "/home/vectone/miniconda3/bin/python test_ticketing_nl_list.py --org_id 1012",
        "```",
        "",
    ])
    path.write_text("\n".join(lines))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--org_id", type=int, default=1012)
    args = parser.parse_args()
    domain_prompt = (PACK / "domain" / "agent.md").read_text()
    sql_prompt = (PACK / "sql_executor" / "agent.md").read_text()
    views_summary = load_views_summary()
    sql_examples = load_examples(PACK / "product" / "examples" / "sql.yml")

    started = time.time()
    results: list[dict[str, Any]] = []
    print("NL list/find suite", "org", args.org_id, "llm", LLM_MODEL)
    for ident in IDENTITIES:
        labels = discover_labels(args.org_id, ident)
        print(f"\n=== {ident['role']} {ident['user_id']} team={labels['team_name']!r} customer={labels['customer_name']!r} ===")
        for spec in questions_for(labels):
            t0 = time.time()
            out = run_turn(
                org_id=args.org_id,
                ident=ident,
                question=spec["q"],
                domain_prompt=domain_prompt,
                sql_prompt=sql_prompt,
                views_summary=views_summary,
                sql_examples=sql_examples,
            )
            issues = judge_rows(ident, spec, out.get("rows") or [], out.get("sql") or "")
            notes = []
            if out["status"] != "ok":
                notes.append(out.get("error") or "execution error")
            notes.extend(issues)
            if out.get("kpi"):
                notes.append(f"domain set kpi={out['kpi']} (list may be a count)")
            if spec["kind"] == "customer_list" and ident["role"] == "resolver" and out["status"] != "ok":
                verdict = "warn"
                notes = ["resolver has no rpt.customers view (expected deny/fail)"]
            elif out["status"] != "ok" or issues:
                verdict = "fail"
            else:
                verdict = "pass"
                if out["row_count"] == 0:
                    verdict = "warn"
                    notes.append("0 rows (ok if none in scope)")
            rec = {
                "role": ident["role"],
                "user_id": ident["user_id"],
                "id": spec["id"],
                "question": spec["q"],
                "row_count": out.get("row_count") or 0,
                "verdict": verdict,
                "notes": "; ".join(notes) or "ok",
                "sql": out.get("sql") or "",
                "seconds": round(time.time() - t0, 1),
            }
            results.append(rec)
            print(f"  {spec['id']:22} {verdict:5} rows={rec['row_count']:4} {rec['seconds']}s  {rec['notes'][:90]}")

    duration = round(time.time() - started, 2)
    out_path = ROOT / "TICKETING_NL_LIST_TEST.md"
    write_report(out_path, args.org_id, results, duration)
    print(f"\nReport: {out_path.name} ({duration}s)")


if __name__ == "__main__":
    main()
