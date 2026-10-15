"""Contact Center NL tests: lists, finds, and named KPI questions.

Admin (org) and agent (own). Does not modify reports_analytics_agent_contact_center.
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
PACK = ROOT / "reports_analytics_agent_contact_center"
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

import reports_analytics_agent_contact_center.sql_executor.core.db as cc_db  # noqa: E402
from reports_analytics_agent_contact_center.sql_executor.core.examples import (  # noqa: E402
    format_examples_for_prompt,
    load_examples,
    pick_examples,
)
from reports_analytics_agent_contact_center.sql_executor.core.run_kpi import run_kpi  # noqa: E402
from reports_analytics_agent_contact_center.sql_executor.core.run_sql import run_sql  # noqa: E402
from reports_analytics_agent_contact_center.core.time import TimeBounds, resolve_expression  # noqa: E402

LLM_BASE = os.getenv("SQL_AGENT_LLM_URL", os.getenv("LLM_BASE_URL", "http://173.234.75.166:8011/v1")).rstrip("/")
LLM_MODEL = os.getenv("SQL_AGENT_LLM_MODEL", os.getenv("LLM_MODEL_NAME", "worktual-gemma"))

IDENTITIES = [
    {"role": "admin", "user_id": 1015, "queue_ids": [1029]},
    {"role": "agent", "user_id": 1015, "queue_ids": [1029]},
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


cc_db.fetchall = safe_fetchall


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


def questions(queue_name: str) -> list[dict[str, str]]:
    return [
        {"id": "list_my_conversations", "q": "List my conversations", "kind": "list"},
        {"id": "list_active", "q": "List active conversations", "kind": "list"},
        {"id": "list_resolved", "q": "List resolved conversations", "kind": "list"},
        {"id": "list_unassigned", "q": "List unassigned conversations", "kind": "list"},
        {"id": "list_today", "q": "List conversations created today", "kind": "list"},
        {"id": "list_last_7d", "q": "List conversations from the last 7 days", "kind": "list"},
        {"id": "list_by_channel", "q": "List conversations by channel", "kind": "list"},
        {"id": "list_abandoned", "q": "List abandoned conversations", "kind": "list"},
        {"id": "list_queues", "q": "List queues", "kind": "list"},
        {"id": "find_queue", "q": f"Find the queue named {queue_name}", "kind": "list"},
        {"id": "list_agents", "q": "List agents", "kind": "list"},
        {"id": "list_statuses", "q": "List conversation statuses", "kind": "list"},
        {"id": "list_calls", "q": "List calls from the last 7 days", "kind": "list"},
        {"id": "list_messages", "q": "List messages from today", "kind": "list"},
        {"id": "kpi_volume", "q": "How many conversations were there in the last 7 days?", "kind": "kpi"},
        {"id": "kpi_asa", "q": "What is our average speed to answer this week?", "kind": "kpi"},
        {"id": "kpi_aht", "q": "What is average handle time last 7 days?", "kind": "kpi"},
        {"id": "kpi_containment", "q": "What is the bot containment rate this week?", "kind": "kpi"},
        {"id": "kpi_fcr", "q": "What is our first contact resolution rate last 30 days?", "kind": "kpi"},
        {"id": "kpi_occupancy", "q": "What is agent occupancy today?", "kind": "kpi"},
        {"id": "who_busiest", "q": "Which agent handled the most conversations last 7 days?", "kind": "list"},
        {"id": "what_channels", "q": "What channels do we have conversations on?", "kind": "list"},
    ]


def run_turn(org_id, ident, question, domain_prompt, sql_prompt, views_summary, sql_examples, kpi_ids):
    role = ident["role"]
    user_id = ident["user_id"]
    queue_ids = ident["queue_ids"]
    domain_user = f"Identity: role={role}, org_id={org_id}, user_id={user_id}, queues={queue_ids}\nQuestion: {question}"
    try:
        domain_raw = call_llm(
            [{"role": "system", "content": domain_prompt}, {"role": "user", "content": domain_user}],
        )
        plan = extract_json(domain_raw) or {}
    except Exception as exc:
        return {"status": "error", "error": f"domain: {exc}", "sql": "", "rows": [], "kpi": None, "row_count": 0}

    tasks = plan.get("tasks") or [{
        "executor": "sql",
        "kpi": None,
        "goal": question,
        "time": "last 7 days",
        "scope": "org" if role == "admin" else "own",
        "answer_type": "list",
    }]
    all_rows = []
    last_sql = ""
    last_kpi = None
    last_error = None
    for task in tasks:
        last_kpi = task.get("kpi")
        time_expr = task.get("time") or "last 7 days"
        scope_expr = task.get("scope") or ("org" if role == "admin" else "own")
        try:
            tb = resolve_expression(time_expr)
        except Exception:
            tb = TimeBounds(None, None, "overall")
        start_iso = tb.start.isoformat() if tb.start else None
        end_iso = tb.end.isoformat() if tb.end else None
        goal = task.get("goal") or question
        result: dict[str, Any] = {}
        if last_kpi and last_kpi in kpi_ids:
            result = run_kpi(
                last_kpi,
                organization_id=org_id,
                user_id=user_id,
                role=role,
                queue_ids=queue_ids,
                scope_level=scope_expr if scope_expr in {"org", "own", "queue", "agent"} else ("org" if role == "admin" else "own"),
                time_start=start_iso,
                time_end=end_iso,
                dsn=DSN,
            )
            last_sql = result.get("sql") or ""
        if (not last_kpi) or result.get("status") == "error":
            query_params = {"start": start_iso, "end": end_iso} if start_iso and end_iso else {}
            time_ctx = (
                f"time_params: start={start_iso}, end={end_iso}\nparams_available: :start, :end"
                if query_params
                else "time_params: overall\nparams_available: none"
            )
            chosen = pick_examples(goal, sql_examples, top_k=6, kind="sql")
            few = format_examples_for_prompt(chosen, kind="sql") if chosen else ""
            prompt = f"{sql_prompt}\n\n{views_summary}\n\n## Few-Shot SQL Examples\n{few}"
            sql_user = f"Task Goal: {goal}\n{time_ctx}\nscope: {scope_expr}\nanswer_type: {task.get('answer_type', 'list')}"
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
                    f"Error: {result.get('error')}\nRewrite using only rpt.* views."
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
    return {
        "status": "ok" if last_error is None else "error",
        "error": last_error,
        "sql": last_sql,
        "rows": all_rows[:50],
        "row_count": len(all_rows),
        "kpi": last_kpi,
        "plan_scope": tasks[0].get("scope") if tasks else None,
    }


def write_report(path, results, duration):
    ok = sum(1 for r in results if r["verdict"] == "pass")
    fail = sum(1 for r in results if r["verdict"] == "fail")
    warn = sum(1 for r in results if r["verdict"] == "warn")
    lines = [
        "# Contact Center natural-language test",
        "",
        "Domain + certified KPI or guarded SQL. SELECT/WITH only. Product folder not edited.",
        "",
        f"- **Duration:** `{duration}s`",
        f"- **Turns:** {len(results)}",
        f"- **Pass / warn / fail:** {ok} / {warn} / {fail}",
        "",
        "Identities: admin and agent both use `ccass.agents` id **1015** (Booxoo Admin) on org 1012, "
        "queue `1029`. Admin plans `org` scope; agent plans `own`.",
        "",
        "| Role | Scenario | Question | Rows | kpi | Verdict | Notes |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in results:
        q = r["question"].replace("|", "/")[:64]
        notes = r["notes"].replace("|", "/")[:90]
        lines.append(
            f"| {r['role']} | `{r['id']}` | {q} | {r['row_count']} | {r.get('kpi') or ''} | {r['verdict']} | {notes} |"
        )
    fails = [r for r in results if r["verdict"] == "fail"]
    lines.extend(["", "## Failures", ""])
    if not fails:
        lines.append("No failed turns.")
    for r in fails:
        lines.append(f"- **{r['role']} `{r['id']}`**: {r['notes']}")
        if r.get("sql"):
            lines.append("```sql")
            lines.append(r["sql"][:600])
            lines.append("```")
    path.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--org_id", type=int, default=1012)
    args = parser.parse_args()
    domain_prompt = (PACK / "domain" / "agent.md").read_text()
    sql_prompt = (PACK / "sql_executor" / "agent.md").read_text()
    views_summary = load_views_summary()
    sql_examples = load_examples(PACK / "product" / "sql" / "examples" / "sql.yml")
    kpi_ids = set((yaml.safe_load((PACK / "product" / "kpis.yml").read_text()) or {}).get("kpis") or {})
    started = time.time()
    results = []
    print("CC NL suite", args.org_id, LLM_MODEL)
    for ident in IDENTITIES:
        print(f"\n=== {ident['role']} {ident['user_id']} ===")
        for spec in questions("Support Queue"):
            t0 = time.time()
            out = run_turn(
                args.org_id, ident, spec["q"], domain_prompt, sql_prompt, views_summary, sql_examples, kpi_ids,
            )
            notes = []
            if out["status"] != "ok":
                notes.append(out.get("error") or "error")
            if spec["kind"] == "list" and ident["role"] == "agent" and out.get("plan_scope") == "org":
                notes.append("agent planned org scope (should be own/queue)")
            if out["status"] != "ok":
                verdict = "fail"
            elif out["row_count"] == 0:
                verdict = "warn"
                notes.append("0 rows")
            else:
                verdict = "pass"
            rec = {
                "role": ident["role"],
                "id": spec["id"],
                "question": spec["q"],
                "row_count": out.get("row_count") or 0,
                "kpi": out.get("kpi"),
                "verdict": verdict,
                "notes": "; ".join(notes) or "ok",
                "sql": out.get("sql") or "",
            }
            results.append(rec)
            print(f"  {spec['id']:24} {verdict:5} rows={rec['row_count']:4} {round(time.time()-t0,1)}s {rec['notes'][:80]}")
    duration = round(time.time() - started, 2)
    path = ROOT / "CONTACT_CENTER_NL_TEST.md"
    write_report(path, results, duration)
    print("Report:", path.name, duration, "s")


if __name__ == "__main__":
    main()
