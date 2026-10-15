"""Advanced NL Scenarios Verification Suite.

Tests:
1. Customer listing and customer search (by name, email)
2. Status and Priority metadata listings (distinct statuses, distinct priorities, categories, channels)
3. Date-based ticket listings (today, yesterday, this week, this month)
4. Role-aware Creator / Assignee / Resolver listings (tickets created by me, assigned to me, other agents)
5. Role-aware Status & Priority filtering across Admin, Agent, Resolver
6. Team / Queue lookups (list teams, find team by name, show team members, my teams)
7. Unassigned ticket queries across Admin, Agent, Resolver
"""

from __future__ import annotations

import datetime
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import httpx
import psycopg2
import yaml
from dotenv import load_dotenv

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


def run_nl_turn(
    user_query: str,
    org_id: int,
    user_id: int,
    role: str,
    queue_ids: list[int],
) -> dict[str, Any]:
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
            "answer_type": "list",
        }]

    task_executions = []
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

        # Quick repair
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
        task_executions.append({
            "task_id": task_id,
            "sql": task_result.get("sql", ""),
            "status": task_result.get("status"),
            "row_count": len(task_result.get("rows", [])),
            "sample_rows": task_result.get("rows", [])[:3],
            "error": task_result.get("error"),
            "fact": fact,
        })

    facts_combined = "\n\n".join(all_facts)

    synthesis_prompt = (
        "You are the Lead Analyst briefing the CEO.\n"
        f"Original Question: {user_query}\n"
        f"Facts gathered:\n{facts_combined}\n\n"
        "Instructions:\n"
        "- Write a clear, executive-level answer directly addressing the user's question.\n"
        "- Lead with the exact primary number or finding in the very first sentence.\n"
        "- Use bold markdown for key metrics and figures.\n"
        "- If the primary number is 0 or no records exist, clearly state that there are 0 records for this organization/scope.\n"
        "- Do NOT mention internal errors, pipeline tools, or REPLAN. State business facts clearly."
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
        "tasks": task_executions,
        "facts": facts_combined,
        "briefing": final_briefing,
        "grounded": g_check.grounded,
    }


def main():
    test_scenarios = [
        # === A. CUSTOMER LISTING & CUSTOMER SEARCH ===
        {"cat": "Customer Listing", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List all customers"},
        {"cat": "Customer Search", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "Find customers named Sarah"},
        {"cat": "Customer Search", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "Find customer with email yahoo"},
        {"cat": "Customer Search", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066], "q": "List customers in my system"},
        {"cat": "Customer Search", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066], "q": "Find customers with gmail email"},

        # === B. METADATA LISTINGS (STATUS, PRIORITY, CATEGORY, CHANNEL) ===
        {"cat": "Metadata Status", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List all ticket statuses"},
        {"cat": "Metadata Priority", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List all ticket priorities"},
        {"cat": "Metadata Category", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List all ticket categories"},
        {"cat": "Metadata Channel", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List all support channels"},

        # === C. DATE-BASED TICKET LISTINGS ===
        {"cat": "Date Listing", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List tickets created today"},
        {"cat": "Date Listing", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List tickets created yesterday"},
        {"cat": "Date Listing", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List tickets created this week"},
        {"cat": "Date Listing", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List tickets created this month"},

        # === D. CREATOR / ASSIGNEE / RESOLVER ROLE LISTINGS ===
        {"cat": "Creator Listing", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List tickets created by me"},
        {"cat": "Assignee Listing", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List tickets assigned to me"},
        {"cat": "Creator Listing", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066], "q": "List tickets created by me"},
        {"cat": "Assignee Listing", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066], "q": "List tickets assigned to me"},
        {"cat": "Other Agents Listing", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066], "q": "List tickets assigned to other agents"},
        {"cat": "Resolver Listing", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066], "q": "Show tickets assigned to me to resolve"},
        {"cat": "Creator Listing", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066], "q": "List tickets created by me"},

        # === E. STATUS & PRIORITY FILTERING PER ROLE ===
        {"cat": "Status Filter (Admin)", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List open tickets across the organization"},
        {"cat": "Priority Filter (Admin)", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List high priority tickets in the organization"},
        {"cat": "Status Filter (Agent)", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066], "q": "List open tickets in my assigned queues"},
        {"cat": "Priority Filter (Agent)", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066], "q": "List high priority tickets assigned to me"},
        {"cat": "Status Filter (Resolver)", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066], "q": "Show open tickets assigned to me to resolve"},
        {"cat": "Priority Filter (Resolver)", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066], "q": "Show high priority tickets assigned to me to resolve"},
        {"cat": "Pending Filter (Resolver)", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066], "q": "Show pending tickets assigned to me to resolve"},

        # === F. TEAMS (QUEUES) & TEAM MEMBERSHIP ===
        {"cat": "Team Listing", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List all teams"},
        {"cat": "Team Search", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "Find team with name Shipping"},
        {"cat": "Team Search", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "Find team with name Payments"},
        {"cat": "Team Members", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "Show members for Payments team"},
        {"cat": "Team Members", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "Who is in Shipping team?"},
        {"cat": "Team Assigned (Agent)", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066], "q": "What teams am I assigned to?"},
        {"cat": "Team Assigned (Resolver)", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066], "q": "What teams am I assigned to?"},

        # === G. UNASSIGNED TICKETS ===
        {"cat": "Unassigned Tickets (Admin)", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066], "q": "List all unassigned tickets"},
        {"cat": "Unassigned Tickets (Agent)", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066], "q": "List unassigned tickets in my queues"},
        {"cat": "Unassigned Tickets (Resolver)", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066], "q": "Show unassigned tickets in my queues"},
    ]

    total = len(test_scenarios)
    print("=" * 80)
    print(f"🚀 RUNNING {total} ADVANCED NL SCENARIOS VERIFICATION")
    print("=" * 80)

    passed = 0
    results_summary = []

    for idx, sc in enumerate(test_scenarios, 1):
        cat = sc["cat"]
        role = sc["role"]
        uid = sc["uid"]
        qids = sc["qids"]
        q = sc["q"]

        print(f"\n[{idx}/{total}] [{role.upper()}] ({cat}) -> \"{q}\"")

        try:
            res = run_nl_turn(
                user_query=q,
                org_id=1012,
                user_id=uid,
                role=role,
                queue_ids=qids,
            )

            all_ok = True
            for t in res["tasks"]:
                st = t.get("status")
                exec_sql = (t.get("sql") or "").strip().upper()
                is_read_only = exec_sql.startswith("SELECT") or exec_sql.startswith("WITH")
                if st != "ok" or not is_read_only:
                    all_ok = False
                    print(f"  ❌ TASK FAILED: status={st}, is_read_only={is_read_only}, error={t.get('error')}")

            row_cnt = res["tasks"][0].get("row_count", 0) if res["tasks"] else 0
            if all_ok:
                passed += 1
                print(f"  ✅ PASS | Rows: {row_cnt}")
                print(f"     Briefing: {res['briefing'][:140]}...")
                if res["tasks"] and res["tasks"][0].get("sample_rows"):
                    print(f"     Sample: {res['tasks'][0]['sample_rows'][0]}")
            else:
                print(f"  ❌ FAILED")

            results_summary.append({
                "id": idx,
                "category": cat,
                "role": role,
                "query": q,
                "rows": row_cnt,
                "status": "PASS" if all_ok else "FAIL",
                "grounded": res.get("grounded", False),
                "briefing": res.get("briefing", ""),
                "sample": res["tasks"][0]["sample_rows"][0] if res["tasks"] and res["tasks"][0].get("sample_rows") else {},
            })

        except Exception as e:
            print(f"  ❌ EXCEPTION: {e}")
            import traceback
            traceback.print_exc()
            results_summary.append({
                "id": idx,
                "category": cat,
                "role": role,
                "query": q,
                "rows": 0,
                "status": "EXCEPTION",
                "grounded": False,
                "briefing": str(e),
                "sample": {},
            })

    pass_rate = (passed / total) * 100
    print("\n" + "=" * 80)
    print(f"🏁 ADVANCED NL BENCHMARK COMPLETED: {passed}/{total} Passed ({pass_rate:.1f}%)")
    print("=" * 80)

    # Save to Markdown
    out_md = ROOT_DIR / "ADVANCED_NL_SCENARIOS_REPORT.md"
    lines = [
        "# Advanced NL Scenarios & Role-Aware Listing Verification Report",
        f"\n**Execution Timestamp:** {datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        f"**Tenant Tested:** Org 1012 (Booxoo)",
        f"**Pass Rate:** **{passed}/{total} ({pass_rate:.1f}%)**",
        "\n| ID | Role | Category | NL Query | Row Count | Sample Data | Grounding | Status |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for r in results_summary:
        st_icon = "✅ Pass" if r["status"] == "PASS" else "❌ Fail"
        g_icon = "🛡️ Yes" if r.get("grounded") else "⚠️ Fallback"
        sample_str = json.dumps(r.get("sample", {}), default=str)
        if len(sample_str) > 40:
            sample_str = sample_str[:37] + "..."
        lines.append(f"| {r['id']} | {r['role'].upper()} | {r['category']} | {r['query']} | **{r['rows']}** | `{sample_str}` | {g_icon} | {st_icon} |")

    out_md.write_text("\n".join(lines))
    print(f"Report generated at: {out_md}")


if __name__ == "__main__":
    main()
