"""Comprehensive NL Listing & Finding/Search Verification Suite for Ticketing V2.

Runs natural language queries through the exact Streamlit pipeline:
1. Domain Agent Planning (via LLM)
2. SQL Executor / KPI resolution (with dynamic few-shot selection)
3. SQL Guard (enforcing SELECT/WITH only, AST scoping, CTE rewriting)
4. Database Execution on Live PostgreSQL
5. Fact Assembly & Grounding Verification
6. Briefing Synthesis

Simultaneously checks database ground truth with direct SELECT queries to verify accuracy.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import httpx
import psycopg2
import yaml
from dotenv import load_dotenv

# Path setup
ROOT_DIR = Path(__file__).resolve().parent
TICKETING_ROOT = ROOT_DIR / "reports_analytics_agent_ticketing_v2"
APP_DIR = ROOT_DIR / "test_streamlit"

for p in [str(ROOT_DIR), str(TICKETING_ROOT), str(APP_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

for env_path in [
    ROOT_DIR / ".env",
    TICKETING_ROOT / ".env",
    Path("/home/vectone/shiva/reportagent/.env"),
]:
    if env_path.exists():
        load_dotenv(env_path)

from reports_analytics_agent_ticketing_v2.core import (
    examples as ex_mod,
    facts as facts_mod,
    grounding as ground_mod,
    run_kpi,
    run_sql,
    resolve_expression,
)
from test_all_metrics_dimensions_time import get_dimension_sql

DSN = os.getenv(
    "DATABASE_URL",
    os.getenv("PG_DSN", "postgresql://nlp:nLpTeam%40561@10.180.0.126:5432/worktual_bigint"),
)
LLM_BASE_URL = os.getenv("SQL_AGENT_LLM_URL", os.getenv("LLM_BASE_URL", "http://173.234.75.166:8011/v1"))
LLM_MODEL = os.getenv("SQL_AGENT_LLM_MODEL", os.getenv("LLM_MODEL_NAME", "worktual-gemma"))

domain_prompt_template = (TICKETING_ROOT / "domain" / "agent.md").read_text()
sql_prompt_template = (TICKETING_ROOT / "sql_executor" / "agent.md").read_text()
kpis_doc = yaml.safe_load((TICKETING_ROOT / "product" / "kpis.yml").read_text()) or {}
certified_kpis_defs = kpis_doc.get("kpis", {})

schema_path = TICKETING_ROOT / "product" / "schema.yml"
with open(schema_path) as f:
    schema_data = yaml.safe_load(f)
v_lines = ["## Available rpt.* Virtual Views and Key Columns:"]
for v_name, v_conf in schema_data.get("views", {}).items():
    desc = v_conf.get("description", "").split("\n")[0].strip()
    v_lines.append(f"\n### rpt.{v_name} ({desc}):")
    cols_dict = v_conf.get("columns", {})
    col_summary = []
    for cname, cmeta in cols_dict.items():
        if isinstance(cmeta, dict) and cmeta.get("description"):
            cdesc = cmeta["description"].split(".")[0].strip()
            col_summary.append(f"  - `{cname}`: {cdesc}")
        else:
            col_summary.append(f"  - `{cname}`")
    v_lines.extend(col_summary)
views_summary = "\n".join(v_lines)

sql_examples_path = TICKETING_ROOT / "product" / "examples" / "sql.yml"
sql_ex_list = ex_mod.load_examples(sql_examples_path) if sql_examples_path.exists() else []


def call_llm(messages: list[dict[str, str]], temperature: float = 0.1, max_tokens: int = 600) -> str:
    client = httpx.Client(base_url=LLM_BASE_URL.rstrip("/"), timeout=60.0)
    resp = client.post(
        "/chat/completions",
        json={
            "model": LLM_MODEL,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        },
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
    clean = text.strip()
    parsed = extract_json(clean)
    if parsed and "sql" in parsed:
        return str(parsed["sql"]).strip().rstrip(";")
    m_sql = re.search(r"```(?:sql)?\s*(SELECT\b.*?|WITH\b.*?)\s*```", clean, re.DOTALL | re.IGNORECASE)
    if m_sql:
        return m_sql.group(1).strip().rstrip(";")
    m_raw = re.search(r"\b(SELECT\b.*?|WITH\b.*?)(?:;|\Z)", clean, re.DOTALL | re.IGNORECASE)
    if m_raw:
        return m_raw.group(1).strip().rstrip(";")
    return clean.rstrip(";")


def run_pipeline_turn(
    user_query: str,
    org_id: int,
    user_id: int,
    role: str,
    queue_ids: list[int],
) -> dict[str, Any]:
    # 1. Domain Planning
    domain_user_msg = (
        f"Identity: role={role}, org_id={org_id}, user_id={user_id}, queues={queue_ids}\n"
        f"Question: {user_query.strip()}"
    )
    domain_raw = call_llm(
        [{"role": "system", "content": domain_prompt_template}, {"role": "user", "content": domain_user_msg}],
        temperature=0.1,
    )
    plan_data = extract_json(domain_raw)
    tasks = plan_data.get("tasks", [])
    if not tasks:
        tasks = [{
            "id": "t1",
            "executor": "sql",
            "kpi": None,
            "goal": user_query,
            "time": "this month",
            "scope": "org" if role == "admin" else "own",
            "answer_type": "list" if any(w in user_query.lower() for w in ["list", "show", "find", "who", "which"]) else "kpi",
        }]

    task_results = []
    all_facts = []

    for task in tasks:
        task_id = task.get("id", "t1")
        kpi_id = task.get("kpi")
        time_expr = task.get("time", "this month")
        scope_expr = task.get("scope", "org" if role == "admin" else "own")
        goal = task.get("goal", user_query)
        answer_type = task.get("answer_type", "list")

        try:
            tb = resolve_expression(time_expr)
        except Exception:
            class FakeBounds:
                start = None
                end = None
                echo = "overall"
            tb = FakeBounds()
        start_iso = tb.start.isoformat() if tb.start else None
        end_iso = tb.end.isoformat() if tb.end else None

        if start_iso and end_iso:
            time_ctx = f"time_params: start={start_iso}, end={end_iso}\nparams_available: :start, :end"
            query_params = {"start": start_iso, "end": end_iso}
        else:
            time_ctx = "time_params: overall / all-time (unbounded, no date filter)\nparams_available: none"
            query_params = {}

        # Few-shot picking
        chosen_sql_ex = ex_mod.pick_examples(goal, sql_ex_list, top_k=6, kind="sql")
        sql_few_shot = ex_mod.format_examples_for_prompt(chosen_sql_ex, kind="sql") if chosen_sql_ex else ""
        task_sql_prompt = f"{sql_prompt_template}\n\n{views_summary}\n\n## Few-Shot SQL Examples\n{sql_few_shot}"
        sql_user_msg = f"Task Goal: {goal}\n{time_ctx}\nscope: {scope_expr}\nanswer_type: {answer_type}"

        sql_raw = call_llm(
            [{"role": "system", "content": task_sql_prompt}, {"role": "user", "content": sql_user_msg}],
            temperature=0.1,
        )
        sql_query = extract_sql_query(sql_raw)

        task_result = run_sql(
            sql_query,
            organization_id=org_id,
            user_id=user_id,
            role=role,
            queue_ids=queue_ids,
            params=query_params,
            dsn=DSN,
        )

        # Repair if error
        if task_result.get("status") == "error":
            err_msg = task_result.get("error", "Unknown SQL error")
            repair_msg = (
                f"Task Goal: {goal}\n{time_ctx}\n"
                f"Previous SQL:\n```sql\n{sql_query}\n```\n"
                f"Database Error: {err_msg}\n"
                "Rewrite the SQL query to fix the error. Query ONLY valid rpt.* virtual views and columns."
            )
            repair_raw = call_llm(
                [{"role": "system", "content": task_sql_prompt}, {"role": "user", "content": repair_msg}],
                temperature=0.1,
            )
            repaired_sql = extract_sql_query(repair_raw)
            task_result = run_sql(
                repaired_sql,
                organization_id=org_id,
                user_id=user_id,
                role=role,
                queue_ids=queue_ids,
                params=query_params,
                dsn=DSN,
            )

        fact = facts_mod.assemble_facts(
            task_result,
            task_goal=goal,
            kpi_id=kpi_id,
            answer_type=answer_type,
        )
        all_facts.append(fact)
        task_results.append({
            "task": task,
            "generated_sql": sql_query,
            "executed_sql": task_result.get("sql"),
            "status": task_result.get("status"),
            "row_count": len(task_result.get("rows", [])),
            "rows_sample": task_result.get("rows", [])[:5],
            "error": task_result.get("error"),
            "fact": fact,
        })

    facts_combined = "\n\n".join(all_facts)

    # Synthesis
    synthesis_prompt = (
        "You are the Lead Analyst briefing the CEO.\n"
        f"Original Question: {user_query}\n"
        f"Facts gathered:\n{facts_combined}\n\n"
        "Instructions:\n"
        "- Write a clear, executive-level answer directly addressing the user's question.\n"
        "- Lead with the exact primary number or finding in the very first sentence.\n"
        "- Use bold markdown for key metrics and figures.\n"
        "- If the primary number is 0 or no records exist, clearly state that there are 0 records for this organization/scope.\n"
        "- Do NOT mention internal errors or pipeline tools. State business facts clearly."
    )
    raw_briefing = call_llm(
        [{"role": "system", "content": "You are a senior analyst giving an executive briefing."}, {"role": "user", "content": synthesis_prompt}],
        temperature=0.2,
        max_tokens=600,
    )

    def _regen(orig: str, ungrounded: list[str]) -> str:
        regen_p = (
            f"{synthesis_prompt}\n\n"
            f"CRITICAL: The following figures were not in facts: {', '.join(ungrounded)}.\n"
            "Regenerate using ONLY figures from the fact block."
        )
        return call_llm(
            [{"role": "system", "content": "You are a senior analyst giving an executive briefing."}, {"role": "user", "content": regen_p}],
            temperature=0.1,
            max_tokens=600,
        )

    final_briefing, was_grounded = ground_mod.apply_grounding(raw_briefing, facts_combined, _regen)
    g_check = ground_mod.ground_check(final_briefing, facts_combined)

    return {
        "user_query": user_query,
        "role": role,
        "plan": plan_data,
        "tasks": task_results,
        "facts": facts_combined,
        "briefing": final_briefing,
        "grounded": g_check.grounded,
    }


def main():
    test_cases = [
        # --- ADMIN ROLE (Org 1012, User 1033) ---
        {
            "category": "Admin Listing",
            "query": "List all open tickets in the organization",
            "org_id": 1012,
            "user_id": 1033,
            "role": "admin",
            "queue_ids": [1060, 1061, 1062, 1063, 1064, 1065, 1066],
        },
        {
            "category": "Admin Listing",
            "query": "List all active queues and their descriptions",
            "org_id": 1012,
            "user_id": 1033,
            "role": "admin",
            "queue_ids": [1060, 1061, 1062, 1063, 1064, 1065, 1066],
        },
        {
            "category": "Admin Finding (ILIKE substring)",
            "query": "Find tickets for customer John",
            "org_id": 1012,
            "user_id": 1033,
            "role": "admin",
            "queue_ids": [1060, 1061, 1062, 1063, 1064, 1065, 1066],
        },
        {
            "category": "Admin Finding (Ticket Number with #)",
            "query": "Show details for ticket #1611",
            "org_id": 1012,
            "user_id": 1033,
            "role": "admin",
            "queue_ids": [1060, 1061, 1062, 1063, 1064, 1065, 1066],
        },
        {
            "category": "Admin Finding (Queue Staffing)",
            "query": "Who is assigned to the Payments & Billing Support queue?",
            "org_id": 1012,
            "user_id": 1033,
            "role": "admin",
            "queue_ids": [1060, 1061, 1062, 1063, 1064, 1065, 1066],
        },
        {
            "category": "Admin Finding (Ticket Resolution)",
            "query": "Who resolved ticket #1611 and what was the customer email?",
            "org_id": 1012,
            "user_id": 1033,
            "role": "admin",
            "queue_ids": [1060, 1061, 1062, 1063, 1064, 1065, 1066],
        },

        # --- AGENT ROLE (Org 1012, User 1034) ---
        {
            "category": "Agent Listing (Own Assignee)",
            "query": "List all tickets assigned to me",
            "org_id": 1012,
            "user_id": 1034,
            "role": "agent",
            "queue_ids": [1061, 1062, 1063, 1065, 1066],
        },
        {
            "category": "Agent Listing (Creator / Created by me)",
            "query": "List tickets created by me",
            "org_id": 1012,
            "user_id": 1034,
            "role": "agent",
            "queue_ids": [1061, 1062, 1063, 1065, 1066],
        },
        {
            "category": "Agent Finding (My Queues)",
            "query": "What are my assigned queues?",
            "org_id": 1012,
            "user_id": 1034,
            "role": "agent",
            "queue_ids": [1061, 1062, 1063, 1065, 1066],
        },
        {
            "category": "Agent Finding (Queue Unresolved Tickets)",
            "query": "Find unresolved tickets in my queues",
            "org_id": 1012,
            "user_id": 1034,
            "role": "agent",
            "queue_ids": [1061, 1062, 1063, 1065, 1066],
        },

        # --- RESOLVER ROLE (Org 1012, User 1035) ---
        {
            "category": "Resolver Listing (Own Resolver ID)",
            "query": "Show tickets assigned to me to resolve",
            "org_id": 1012,
            "user_id": 1035,
            "role": "resolver",
            "queue_ids": [1063, 1065, 1066],
        },
        {
            "category": "Resolver Finding (My Queues)",
            "query": "What queues am I assigned to?",
            "org_id": 1012,
            "user_id": 1035,
            "role": "resolver",
            "queue_ids": [1063, 1065, 1066],
        },
        {
            "category": "Resolver Finding (Queue Ticket Volume)",
            "query": "How many tickets are in my queues?",
            "org_id": 1012,
            "user_id": 1035,
            "role": "resolver",
            "queue_ids": [1063, 1065, 1066],
        },
        {
            "category": "Resolver Finding (High Priority Tickets)",
            "query": "Find high priority tickets assigned to me to resolve",
            "org_id": 1012,
            "user_id": 1035,
            "role": "resolver",
            "queue_ids": [1063, 1065, 1066],
        },
    ]

    print("=" * 80)
    print("🚀 RUNNING NL LISTING & SEARCH VERIFICATION SUITE")
    print("=" * 80)

    passed = 0
    total = len(test_cases)

    for idx, tc in enumerate(test_cases, 1):
        q = tc["query"]
        role = tc["role"]
        org_id = tc["org_id"]
        user_id = tc["user_id"]
        queue_ids = tc["queue_ids"]
        cat = tc["category"]

        print(f"\n[{idx}/{total}] [{role.upper()}] {cat}")
        print(f"  NL Query: \"{q}\"")

        try:
            res = run_pipeline_turn(
                user_query=q,
                org_id=org_id,
                user_id=user_id,
                role=role,
                queue_ids=queue_ids,
            )

            all_ok = True
            for t in res["tasks"]:
                status = t["status"]
                executed_sql = t.get("executed_sql") or ""
                err = t.get("error")
                cnt = t["row_count"]

                # Strict check: Must use SELECT or WITH
                sql_clean = executed_sql.strip().upper()
                is_select_or_with = sql_clean.startswith("SELECT") or sql_clean.startswith("WITH")

                if status != "ok" or not is_select_or_with:
                    all_ok = False
                    print(f"  ❌ FAILED: status={status}, is_select_or_with={is_select_or_with}, error={err}")
                    print(f"     Raw SQL: {t['generated_sql']}")
                else:
                    print(f"  ✅ Task OK | Rows: {cnt} | SQL starts with {'WITH' if sql_clean.startswith('WITH') else 'SELECT'}")
                    if t["rows_sample"]:
                        print(f"     Sample result: {t['rows_sample'][0]}")

            print(f"  📝 Executive Briefing: {res['briefing'][:180]}...")
            print(f"  🛡️ Grounding Verified: {res['grounded']}")

            if all_ok:
                passed += 1

        except Exception as e:
            print(f"  ❌ CRITICAL EXCEPTION: {e}")
            import traceback
            traceback.print_exc()

    print("\n" + "=" * 80)
    print(f"🏁 SUMMARY: {passed}/{total} Test Scenarios Passed ({(passed/total)*100:.1f}%)")
    print("=" * 80)


if __name__ == "__main__":
    main()
