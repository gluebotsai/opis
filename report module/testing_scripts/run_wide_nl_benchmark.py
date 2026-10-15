"""Comprehensive 55+ NL Query Verification Benchmark against Live Postgres Database.

Covers:
- Volume & Velocity KPIs (ticket count, closed, open, pending, overdue, reopened, backlog)
- Service Quality & SLA (SLA breach rate, compliance rate, FCR, FRT, MTTR, CSAT)
- Operational & Workload (reassignment rate, escalation rate, unread notifications)
- Multi-dimensional Breakdowns (priority, channel, queue, category, agent, day, month)
- Time Horizons (this month, last 7 days, last 30 days, all time, today)
- Listing & Search (partial name ILIKE, ticket # lookup, creator/resolver/assignee)
- Multi-Role Scoping (Admin org-wide, Agent queue/assignee/creator, Resolver resolver_id/queue)
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


def detect_dimension(task: dict[str, Any], user_query: str, allowed_dimensions: list[str]) -> str | None:
    if not allowed_dimensions:
        return None
    for key in ["dimension", "dim", "group_by", "breakdown"]:
        val = task.get(key)
        if isinstance(val, list) and val:
            cand = str(val[0]).strip().lower()
            if cand in allowed_dimensions:
                return cand
        elif isinstance(val, str) and val.strip():
            cand = val.strip().lower()
            if cand in allowed_dimensions:
                return cand

    text = (str(task.get("goal", "")) + " " + user_query).lower()
    synonym_map = {
        "channel": ["channel", "channels"],
        "priority": ["priority", "priorities", "urgency"],
        "status": ["status", "state", "lifecycle"],
        "queue": ["queue", "queues", "group", "department"],
        "agent": ["agent", "agents", "assignee", "resolver", "rep"],
        "resolver": ["resolver", "resolvers"],
        "category": ["category", "categories", "type"],
        "customer": ["customer", "customers", "client"],
        "day": ["by day", "daily", "per day"],
        "week": ["by week", "weekly", "per week"],
        "month": ["by month", "monthly", "per month"],
    }
    for dim in allowed_dimensions:
        synonyms = synonym_map.get(dim, [dim])
        if any(re.search(rf"\b{re.escape(syn)}\b", text) for syn in synonyms):
            return dim
    return None


def detect_filters(task: dict[str, Any], user_query: str) -> str | None:
    text = (str(task.get("goal", "")) + " " + user_query).lower()
    clauses: list[str] = []
    for p in ["urgent", "high", "medium", "low"]:
        if re.search(rf"\b{p}\b(?:\s+priority)?", text):
            clauses.append(f"priority = '{p}'")
            break
    if re.search(r"\bopen\s+(?:ticket|tickets)\b|\bstatus\s*=\s*['\"]?open['\"]?\b", text):
        clauses.append("status = 'Open'")
    elif re.search(r"\b(?:literal\s+pending|status\s*=\s*['\"]?pending['\"]?)\b", text):
        clauses.append("status = 'Pending'")
    elif re.search(r"\b(?:pending|unresolved|outstanding)\s+(?:ticket|tickets)?\b", text):
        clauses.append("status NOT IN ('Closed', 'Resolved')")
    elif re.search(r"\bclosed\s+(?:ticket|tickets)\b", text):
        clauses.append("status = 'Closed'")
    elif re.search(r"\bresolved\s+(?:ticket|tickets)\b", text):
        clauses.append("status = 'Resolved'")
    elif re.search(r"\boverdue\s+(?:ticket|tickets)\b", text):
        clauses.append("status = 'Overdue'")
    elif re.search(r"\breopened\s+(?:ticket|tickets)\b", text):
        clauses.append("status = 'Reopened'")
    if clauses:
        return " AND ".join(clauses)
    return None


def run_single_benchmark(
    query_id: int,
    user_query: str,
    org_id: int,
    user_id: int,
    role: str,
    queue_ids: list[int],
    category: str,
) -> dict[str, Any]:
    start_t = time.time()
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
            "answer_type": "kpi",
        }]

    task_executions = []
    all_facts = []

    for task in tasks:
        task_id = task.get("id", "t1")
        kpi_id = task.get("kpi")
        time_expr = task.get("time", "this month")
        scope_expr = task.get("scope", "org" if role == "admin" else "own")
        goal = task.get("goal", user_query)
        answer_type = task.get("answer_type", "kpi")

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

        task_result: dict[str, Any] = {}
        exec_type = "free_sql"

        # Certified KPI Path
        if kpi_id and kpi_id in certified_kpis_defs:
            exec_type = f"kpi:{kpi_id}"
            kpi_card = certified_kpis_defs[kpi_id]
            allowed_dims = list(kpi_card.get("allowed_dimensions") or [])
            dim = detect_dimension(task, user_query, allowed_dims)
            slot_values = {}
            if dim:
                template_file = TICKETING_ROOT / "product" / "sql" / f"{kpi_id}.sql"
                template_text = template_file.read_text() if template_file.exists() else ""
                dim_sql = get_dimension_sql("ticketing", kpi_id, dim, template_text)
                if dim_sql:
                    slot_values["dimension_select"] = dim_sql[0]
                    slot_values["group_by_sql"] = dim_sql[1]
            filt = detect_filters(task, user_query)
            if filt:
                slot_values["filters_sql"] = filt

            task_result = run_kpi(
                kpi_id,
                organization_id=org_id,
                user_id=user_id,
                role=role,
                queue_ids=queue_ids,
                scope_level=scope_expr,
                time_start=start_iso,
                time_end=end_iso,
                slot_values=slot_values,
                dsn=DSN,
            )

        # Free SQL fallback / direct
        if (not kpi_id) or (task_result.get("status") == "error"):
            exec_type = "free_sql"
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

            # Repair
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
            "exec_type": exec_type,
            "status": task_result.get("status"),
            "sql": task_result.get("sql", ""),
            "row_count": len(task_result.get("rows", [])),
            "rows": task_result.get("rows", []),
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

    duration = time.time() - start_t
    return {
        "query_id": query_id,
        "category": category,
        "user_query": user_query,
        "role": role,
        "org_id": org_id,
        "user_id": user_id,
        "tasks": task_executions,
        "facts": facts_combined,
        "briefing": final_briefing,
        "grounded": g_check.grounded,
        "duration_s": round(duration, 2),
    }


def build_benchmark_test_cases() -> list[dict[str, Any]]:
    # 56 distinct queries covering all angles
    return [
        # === 1. VOLUME & VELOCITY METRICS (ADMIN) ===
        {"id": 1, "cat": "Volume KPI", "q": "How many total tickets were created this month?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 2, "cat": "Volume KPI", "q": "What is the total ticket volume all time?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 3, "cat": "Volume KPI", "q": "How many tickets were resolved in the last 30 days?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 4, "cat": "Volume KPI", "q": "How many tickets were closed this month?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 5, "cat": "Status Filter", "q": "How many open tickets do we currently have?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 6, "cat": "Status Filter", "q": "How many pending tickets are currently unresolved?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 7, "cat": "Status Filter", "q": "Count overdue tickets in the organization", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 8, "cat": "Status Filter", "q": "How many tickets were reopened this month?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 9, "cat": "Notification", "q": "How many unread notifications are in the system?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},

        # === 2. SERVICE QUALITY & SLA METRICS (ADMIN) ===
        {"id": 10, "cat": "SLA Quality", "q": "What is our SLA breach rate this month?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 11, "cat": "SLA Quality", "q": "What is our SLA compliance rate for the last 30 days?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 12, "cat": "Speed Quality", "q": "What is the First Contact Resolution rate this month?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 13, "cat": "Speed Quality", "q": "What is the Average First Response Time (FRT) this month?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 14, "cat": "Speed Quality", "q": "What is the Mean Time to Resolve (MTTR) this month?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 15, "cat": "CSAT Quality", "q": "What is our average CSAT score this month?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 16, "cat": "Operational", "q": "What is our reassignment rate this month?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 17, "cat": "Operational", "q": "What is the escalation rate this month?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},

        # === 3. DIMENSIONAL GROUPINGS (ADMIN) ===
        {"id": 18, "cat": "Dimension Breakdown", "q": "Show ticket count by priority this month", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 19, "cat": "Dimension Breakdown", "q": "Show ticket count by status this month", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 20, "cat": "Dimension Breakdown", "q": "Show ticket count by channel this month", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 21, "cat": "Dimension Breakdown", "q": "Show ticket volume broken down by queue", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 22, "cat": "Dimension Breakdown", "q": "Breakdown SLA breach rate by priority this month", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 23, "cat": "Dimension Breakdown", "q": "Show CSAT score by queue this month", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 24, "cat": "Dimension Breakdown", "q": "Show FCR rate broken down by channel this month", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 25, "cat": "Time Trend", "q": "Show daily ticket count for the last 7 days", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},

        # === 4. LISTING & SEARCH (ADMIN) ===
        {"id": 26, "cat": "Admin Listing", "q": "List all open tickets in the organization", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 27, "cat": "Admin Listing", "q": "List all urgent priority tickets", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 28, "cat": "Admin Listing", "q": "List active queues and their types", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 29, "cat": "Admin Listing", "q": "List the support agents in the organization", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 30, "cat": "Admin Search", "q": "Find tickets for customer John", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 31, "cat": "Admin Search", "q": "Find tickets for customer with email gmail", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 32, "cat": "Admin Lookup", "q": "Show details for ticket #1611", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 33, "cat": "Admin Lookup", "q": "Who created ticket #1611?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 34, "cat": "Admin Lookup", "q": "Who resolved ticket #1611?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},
        {"id": 35, "cat": "Admin Staffing", "q": "Who is assigned to the Payments & Billing Support queue?", "role": "admin", "uid": 1033, "qids": [1060,1061,1062,1063,1064,1065,1066]},

        # === 5. AGENT ROLE SCENARIOS (User 1034) ===
        {"id": 36, "cat": "Agent Volume", "q": "How many tickets are assigned to me this month?", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 37, "cat": "Agent Volume", "q": "What is my total ticket count all time?", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 38, "cat": "Agent Quality", "q": "What is my SLA breach rate this month?", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 39, "cat": "Agent Quality", "q": "What is my average CSAT score this month?", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 40, "cat": "Agent Quality", "q": "What is my First Contact Resolution rate this month?", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 41, "cat": "Agent Notification", "q": "How many unread notifications do I have?", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 42, "cat": "Agent Breakdown", "q": "Show my tickets by priority this month", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 43, "cat": "Agent Breakdown", "q": "Show my tickets by status this month", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 44, "cat": "Agent Listing", "q": "List all tickets assigned to me", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 45, "cat": "Agent Listing", "q": "List tickets created by me", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 46, "cat": "Agent Queue", "q": "What are my assigned queues?", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 47, "cat": "Agent Queue", "q": "Find unresolved tickets in my queues", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},
        {"id": 48, "cat": "Agent Search", "q": "Find high priority tickets in my queues", "role": "agent", "uid": 1034, "qids": [1061,1062,1063,1065,1066]},

        # === 6. RESOLVER ROLE SCENARIOS (User 1035) ===
        {"id": 49, "cat": "Resolver Volume", "q": "How many tickets are assigned to me to resolve this month?", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066]},
        {"id": 50, "cat": "Resolver Volume", "q": "What is my total assigned ticket count all time?", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066]},
        {"id": 51, "cat": "Resolver Quality", "q": "What is my SLA compliance rate this month?", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066]},
        {"id": 52, "cat": "Resolver Notification", "q": "How many unread notifications do I have?", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066]},
        {"id": 53, "cat": "Resolver Listing", "q": "Show tickets assigned to me to resolve", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066]},
        {"id": 54, "cat": "Resolver Listing", "q": "Find high priority tickets assigned to me to resolve", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066]},
        {"id": 55, "cat": "Resolver Queue", "q": "What queues am I assigned to?", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066]},
        {"id": 56, "cat": "Resolver Queue", "q": "How many tickets are in my queues?", "role": "resolver", "uid": 1035, "qids": [1063,1065,1066]},
    ]


def main():
    test_cases = build_benchmark_test_cases()
    total = len(test_cases)
    print(f"================================================================================")
    print(f"🚀 STARTING WIDE NL BENCHMARK: {total} QUERIES ACROSS ALL TOPICS & ROLES")
    print(f"================================================================================")

    results = []
    passed_count = 0

    for tc in test_cases:
        qid = tc["id"]
        cat = tc["cat"]
        q = tc["q"]
        role = tc["role"]
        uid = tc["uid"]
        qids = tc["qids"]

        print(f"\n[{qid}/{total}] [{role.upper()}] ({cat}) -> \"{q}\"")

        try:
            res = run_single_benchmark(
                query_id=qid,
                user_query=q,
                org_id=1012,
                user_id=uid,
                role=role,
                queue_ids=qids,
                category=cat,
            )

            all_tasks_ok = True
            for t in res["tasks"]:
                status = t["status"]
                executed_sql = t.get("sql") or ""
                sql_clean = executed_sql.strip().upper()
                is_select_or_with = sql_clean.startswith("SELECT") or sql_clean.startswith("WITH")
                if status != "ok" or not is_select_or_with:
                    all_tasks_ok = False
                    print(f"  ❌ TASK FAILED: status={status}, is_select_or_with={is_select_or_with}, error={t.get('error')}")
                else:
                    print(f"  ✅ Task OK [{t['exec_type']}] | Rows: {t['row_count']} | Elapsed: {res['duration_s']}s")

            if all_tasks_ok:
                passed_count += 1
                res["overall_status"] = "PASS"
            else:
                res["overall_status"] = "FAIL"

            results.append(res)
            print(f"  📝 Briefing: {res['briefing'][:140]}...")

        except Exception as e:
            print(f"  ❌ UNHANDLED EXCEPTION: {e}")
            import traceback
            traceback.print_exc()
            results.append({
                "query_id": qid,
                "category": cat,
                "user_query": q,
                "role": role,
                "org_id": 1012,
                "user_id": uid,
                "overall_status": "EXCEPTION",
                "error": str(e),
                "tasks": [],
                "briefing": "",
                "grounded": False,
                "duration_s": 0.0,
            })

    # Summary calculation
    pass_pct = (passed_count / total) * 100
    print("\n" + "=" * 80)
    print(f"🏁 BENCHMARK COMPLETED: {passed_count}/{total} Passed ({pass_pct:.1f}%)")
    print("=" * 80)

    # Save JSON results
    out_json = ROOT_DIR / "nl_benchmark_results.json"
    with open(out_json, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"Saved benchmark data to {out_json}")


if __name__ == "__main__":
    main()
