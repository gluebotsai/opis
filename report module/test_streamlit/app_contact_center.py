"""Streamlit Contact Center Analytics Chat Interface & Session Logger.

Clean conversational interface:
  - Input Context: Org ID, User ID, Role (admin / agent)
  - Interactive Chat: st.chat_message, st.chat_input
  - Real-time Multi-Agent Execution & Logging:
      1. Contact Center Domain Planning
      2. Few-shot Selection & Guarded SQL / KPI Execution
      3. Fact Assembly & Arithmetic
      4. Grounding Check (Anti-Hallucination)
      5. Executive Briefing Synthesis
  - Persistent Session Logging to JSON & Markdown in test_streamlit/logs/
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Any

import httpx
import streamlit as st
import yaml
from dotenv import load_dotenv

# Path setup
APP_DIR = Path(__file__).resolve().parent
WORKSPACE_ROOT = APP_DIR.parent
PACK_ROOT = WORKSPACE_ROOT / "reports_analytics_agent_contact_center"

for p in [str(WORKSPACE_ROOT), str(PACK_ROOT), str(APP_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

# Load environment variables
for env_path in [
    WORKSPACE_ROOT / ".env",
    PACK_ROOT / ".env",
    Path("/home/vectone/shiva/reportagent/.env"),
]:
    if env_path.exists():
        load_dotenv(env_path)

from test_streamlit.logger import TurnLogger

from reports_analytics_agent_contact_center.sql_executor.core.examples import (
    format_examples_for_prompt,
    load_examples,
    pick_examples,
)
from reports_analytics_agent_contact_center.core.facts import assemble_facts
from reports_analytics_agent_contact_center.core.grounding import apply_grounding, ground_check
from reports_analytics_agent_contact_center.core.loop import LoopState
from reports_analytics_agent_contact_center.sql_executor.core.run_kpi import run_kpi
from reports_analytics_agent_contact_center.sql_executor.core.run_sql import run_sql
from reports_analytics_agent_contact_center.core.time import TimeBounds, resolve_expression

st.set_page_config(
    page_title="Contact Center Analytics V2 — Agent Chat",
    page_icon="🎧",
    layout="wide",
)

# -----------------------------------------------------------------------------
# SIDEBAR: MINIMAL CONTEXT CONTROLS
# -----------------------------------------------------------------------------
with st.sidebar:
    st.header("⚙️ Execution Context")
    org_id = st.number_input("Organization ID", value=1000, step=1, help="Target tenant ID")
    user_id = st.number_input("User ID", value=10, step=1, help="User ID of the caller")
    role = st.selectbox("Role", ["admin", "agent"], index=0, help="Access role (2-tier: admin or agent)")

    # Default queues for context
    default_queues = [1, 2] if role == "admin" else [1]
    with st.expander("Advanced Settings", expanded=False):
        queue_ids_str = st.text_input(
            "Queue IDs",
            value=", ".join(str(q) for q in default_queues),
            help="Comma-separated queue IDs for agent context",
        )
        queue_ids = [int(q.strip()) for q in queue_ids_str.split(",") if q.strip().isdigit()]

        llm_base_url = st.text_input(
            "LLM Endpoint",
            value=os.getenv("LLM_BASE_URL", "http://173.234.75.166:8011/v1"),
        )
        llm_model = st.text_input(
            "LLM Model",
            value=os.getenv("LLM_MODEL_NAME", "worktual-gemma"),
        )
        pg_host = st.text_input("Database Host", value=os.getenv("PG_HOST", "10.180.0.126"))
        pg_port = st.text_input("Database Port", value=os.getenv("PG_PORT", "5432"))
        pg_db = st.text_input("Database Name", value=os.getenv("PG_DATABASE", "worktual_bigint"))
        pg_user = st.text_input("Database User", value=os.getenv("PG_USER", "nlp"))
        pg_pass = st.text_input("Database Password", value=os.getenv("PG_PASSWORD", "nLpTeam@561"), type="password")

    quoted_pass = urllib.parse.quote_plus(pg_pass) if pg_pass else ""
    active_dsn = (
        f"postgresql://{pg_user}:{quoted_pass}@{pg_host}:{pg_port}/{pg_db}"
        if quoted_pass
        else f"postgresql://{pg_user}@{pg_host}:{pg_port}/{pg_db}"
    )

    st.divider()
    st.caption(f"🛡️ Active Context: **{role.upper()}** | Org `{org_id}` | User `{user_id}`")
    if st.button("🗑️ Clear Chat History", use_container_width=True):
        st.session_state.messages = []
        st.rerun()


# -----------------------------------------------------------------------------
# LLM HELPERS
# -----------------------------------------------------------------------------
def call_llm(messages: list[dict[str, str]], temperature: float = 0.1, max_tokens: int = 600) -> str:
    """Send chat completion request to vLLM endpoint."""
    client = httpx.Client(base_url=llm_base_url.rstrip("/"), timeout=40.0)
    resp = client.post(
        "/chat/completions",
        json={
            "model": llm_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        },
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def extract_json(text: str) -> dict[str, Any]:
    """Parse JSON payload from markdown block or raw text."""
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
    """Extract SQL query string from markdown block, json payload, or raw text."""
    clean = text.strip()
    m_sql = re.search(r"```(?:sql)?\s*(SELECT\b.*?|WITH\b.*?)\s*```", clean, re.DOTALL | re.IGNORECASE)
    if m_sql:
        return m_sql.group(1).strip()
    parsed = extract_json(clean)
    if parsed and "sql" in parsed:
        return str(parsed["sql"]).strip()
    m_raw = re.search(r"\b(SELECT\b.*?|WITH\b.*?)(?:;|\Z)", clean, re.DOTALL | re.IGNORECASE)
    if m_raw:
        return m_raw.group(1).strip()
    return clean


# Load Prompts & Schemas
domain_prompt_template = (PACK_ROOT / "domain" / "agent.md").read_text()
sql_prompt_template = (PACK_ROOT / "sql_executor" / "agent.md").read_text()

schema_path = PACK_ROOT / "product" / "schema.yml"
if schema_path.exists():
    with open(schema_path) as f:
        schema_data = yaml.safe_load(f)
    v_lines = ["## Available rpt.* Virtual Views and Columns:"]
    for v_name, v_conf in schema_data.get("views", {}).items():
        cols = ", ".join(v_conf.get("columns", {}).keys())
        desc = v_conf.get("description", "").split("\n")[0].strip()
        v_lines.append(f"- rpt.{v_name} ({desc}): {cols}")
    views_summary = "\n".join(v_lines)
else:
    views_summary = ""

sql_examples_path = PACK_ROOT / "product" / "sql" / "examples" / "sql.yml"


# -----------------------------------------------------------------------------
# CHAT INTERFACE
# -----------------------------------------------------------------------------
st.title("🎧 Contact Center Reports & Analytics Agent")
st.caption(f"Ask any contact center analytics, KPI, breakdown, or performance question. Identity: **{role.upper()}** (Org `{org_id}`, User `{user_id}`)")

# Initialize session state for chat history
if "messages" not in st.session_state:
    st.session_state.messages = []

# Display previous messages
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])
        if "rows" in msg and msg["rows"]:
            with st.expander(f"📊 Result Table ({len(msg['rows'])} rows)", expanded=False):
                st.dataframe(msg["rows"], use_container_width=True)
        if "trace" in msg and msg["trace"]:
            with st.expander("🔍 Agent Thought & Execution Trace", expanded=False):
                st.markdown(msg["trace"])

# User Chat Input
if user_query := st.chat_input("Ask a question (e.g. 'What is our ASA this month?', 'Show containment rate', 'List active conversations')"):
    # Add user message to UI
    st.session_state.messages.append({"role": "user", "content": user_query})
    with st.chat_message("user"):
        st.markdown(user_query)

    # Run Multi-Agent Turn
    with st.chat_message("assistant"):
        logger = TurnLogger(
            question=user_query.strip(),
            context={
                "org_id": int(org_id),
                "user_id": int(user_id),
                "role": role,
                "queue_ids": queue_ids,
                "llm_model": llm_model,
            },
        )
        loop = LoopState(max_attempts=2)
        trace_lines = []

        with st.status("Agents are analyzing and executing query...", expanded=True) as status_box:
            # 1. Domain Agent Planning
            domain_user_msg = (
                f"Identity: role={role}, org_id={org_id}, user_id={user_id}, queues={queue_ids}\n"
                f"Question: {user_query.strip()}"
            )
            logger.log_message(role="system", agent="domain_agent", content=domain_prompt_template)
            logger.log_message(role="user", agent="domain_agent", content=domain_user_msg)

            plan_data = {"tasks": []}
            try:
                domain_raw = call_llm(
                    [{"role": "system", "content": domain_prompt_template}, {"role": "user", "content": domain_user_msg}],
                    temperature=0.1,
                )
                logger.log_message(role="assistant", agent="domain_agent", content=domain_raw)
                plan_data = extract_json(domain_raw)
                logger.log_tool_call(agent="domain_agent", tool_name="plan_tasks", arguments=plan_data)
                st.write(f"🧠 **Domain Plan**: {plan_data.get('depth', 'standard')} depth, {len(plan_data.get('tasks', []))} task(s)")
                trace_lines.append(f"### 1. Domain Plan\n```json\n{json.dumps(plan_data, indent=2)}\n```")
            except Exception as e:
                st.error(f"Planning Error: {e}")
                logger.log_message(role="error", agent="domain_agent", content=str(e))

            tasks = plan_data.get("tasks", [])
            all_facts = []
            all_rows = []

            # 2. Execution Loop
            for task in tasks:
                task_id = task.get("id", "t1")
                executor = task.get("executor", "sql")
                kpi_id = task.get("kpi")
                time_expr = task.get("time", "this month")
                scope_expr = task.get("scope", "org" if role == "admin" else "own")
                goal = task.get("goal", user_query)
                answer_type = task.get("answer_type", "kpi")

                st.write(f"⚙️ **Executing Task {task_id}** via `{executor}`...")

                try:
                    tb = resolve_expression(time_expr)
                except Exception:
                    tb = TimeBounds(None, None, "overall (no date filter, UTC)")
                start_iso = tb.start.isoformat() if tb.start else None
                end_iso = tb.end.isoformat() if tb.end else None

                task_result: dict[str, Any] = {}
                loop.record_attempt()

                if kpi_id:
                    logger.log_tool_call(
                        agent="certified_kpi_executor",
                        tool_name="run_kpi",
                        arguments={"kpi_id": kpi_id, "scope": scope_expr, "time": tb.echo},
                    )
                    task_result = run_kpi(
                        kpi_id,
                        organization_id=int(org_id),
                        user_id=int(user_id),
                        role=role,
                        queue_ids=queue_ids,
                        scope_level=scope_expr,
                        time_start=start_iso,
                        time_end=end_iso,
                        dsn=active_dsn,
                    )
                    logger.log_guard(
                        guard_type="KPI_Template_Slots",
                        input_query=kpi_id,
                        output_query=task_result.get("sql", ""),
                        params={"org_id": org_id, "scope": scope_expr},
                    )
                    trace_lines.append(f"### 2. Task `{task_id}` (Certified KPI: `{kpi_id}`)\n```sql\n{task_result.get('sql', '')}\n```")
                else:
                    if start_iso and end_iso:
                        time_ctx = f"time_params: start={start_iso}, end={end_iso}\nparams_available: :start, :end"
                        query_params = {"start": start_iso, "end": end_iso}
                    else:
                        time_ctx = "time_params: overall / all-time (unbounded, no date filter)\nparams_available: none"
                        query_params = {}

                    # Dynamic Few-Shot Picking
                    sql_ex_list = load_examples(sql_examples_path) if sql_examples_path.exists() else []
                    chosen_sql_ex = pick_examples(goal, sql_ex_list, top_k=6, kind="sql")
                    sql_few_shot = format_examples_for_prompt(chosen_sql_ex, kind="sql") if chosen_sql_ex else ""
                    task_sql_prompt = f"{sql_prompt_template}\n\n{views_summary}\n\n## Few-Shot SQL Examples\n{sql_few_shot}"
                    sql_user_msg = f"Task Goal: {goal}\n{time_ctx}\nscope: {scope_expr}\nanswer_type: {answer_type}"

                    logger.log_message(role="system", agent="sql_executor", content=task_sql_prompt)
                    logger.log_message(role="user", agent="sql_executor", content=sql_user_msg)

                    sql_raw = call_llm(
                        [{"role": "system", "content": task_sql_prompt}, {"role": "user", "content": sql_user_msg}],
                        temperature=0.1,
                    )
                    logger.log_message(role="assistant", agent="sql_executor", content=sql_raw)

                    sql_tool = extract_json(sql_raw)
                    sql_query = extract_sql_query(sql_raw)
                    task_params = (sql_tool.get("params") if isinstance(sql_tool, dict) else None) or query_params
                    logger.log_tool_call(agent="sql_executor", tool_name="run_sql", arguments={"raw_sql": sql_query})

                    task_result = run_sql(
                        sql_query,
                        organization_id=int(org_id),
                        user_id=int(user_id),
                        role=role,
                        queue_ids=queue_ids,
                        params=task_params,
                        dsn=active_dsn,
                    )

                    logger.log_guard(
                        guard_type="SQL_AST_Guard",
                        input_query=sql_query,
                        output_query=task_result.get("sql", ""),
                        params=task_result.get("bound_params", {}),
                        notes=task_result.get("guard_notes", []),
                        error=task_result.get("error") if task_result.get("status") == "error" else None,
                    )
                    trace_lines.append(f"### 2. Task `{task_id}` (Guarded SQL)\n```sql\n{task_result.get('sql', '')}\n```")

                # Collect result rows
                if task_result.get("rows"):
                    all_rows.extend(task_result["rows"])

                # Assemble Fact Block
                fact = assemble_facts(
                    task_result,
                    task_goal=goal,
                    kpi_id=kpi_id,
                    answer_type=answer_type,
                )
                all_facts.append(fact)
                logger.log_message(role="fact_assembly", agent="facts_module", content=fact)

            # 3. Domain Synthesis & Grounding
            facts_combined = "\n\n".join(all_facts)
            trace_lines.append(f"### 3. Assembled Facts Block\n```text\n{facts_combined}\n```")

            synthesis_prompt = (
                f"You are the Lead Analyst briefing the VP of Operations and Contact Center Leadership.\n"
                f"Original Question: {user_query}\n"
                f"Facts gathered:\n{facts_combined}\n\n"
                "Instructions:\n"
                "- Write a clear, executive-level answer directly addressing the user's question.\n"
                "- Lead with the exact primary number or finding in the very first sentence.\n"
                "- Use bold markdown for key metrics and figures.\n"
                "- Explain operational context concisely. If there are top queues/channels/drivers, summarize them.\n"
                "- If the primary number is 0 or no records exist, clearly state that there are 0 records for this organization/scope.\n"
                "- Do NOT mention internal errors, REPLAN, system architecture, or pipeline tools. State business facts clearly.\n"
                "- Do NOT use headings like 'Analysis' or 'Narrative'. Just clean, natural prose."
            )
            logger.log_message(role="system", agent="domain_synthesis", content="Executive analyst briefing.")
            logger.log_message(role="user", agent="domain_synthesis", content=synthesis_prompt)

            try:
                raw_briefing = call_llm(
                    [{"role": "system", "content": "You are a senior analyst giving an executive briefing to Contact Center Leadership."}, {"role": "user", "content": synthesis_prompt}],
                    temperature=0.2,
                    max_tokens=600,
                )
                logger.log_message(role="assistant", agent="domain_synthesis", content=raw_briefing)

                def _regen_briefing(orig_answer: str, ungrounded: list[str]) -> str:
                    regen_prompt = (
                        f"{synthesis_prompt}\n\n"
                        f"CRITICAL: The following figures in your previous answer were not found in the source facts: {', '.join(ungrounded)}.\n"
                        "Regenerate the answer using ONLY numbers that appear in the facts block above."
                    )
                    return call_llm(
                        [{"role": "system", "content": "You are a senior analyst giving an executive briefing to Contact Center Leadership."}, {"role": "user", "content": regen_prompt}],
                        temperature=0.1,
                        max_tokens=600,
                    )

                final_briefing, was_grounded = apply_grounding(raw_briefing, facts_combined, _regen_briefing)
                g_check = ground_check(final_briefing, facts_combined)
                logger.log_grounding(
                    grounded=g_check.grounded,
                    ungrounded=g_check.ungrounded,
                    answer_numbers=g_check.answer_numbers,
                    was_regenerated=(raw_briefing != final_briefing),
                )
                trace_lines.append(f"### 4. Grounding Check\n- Grounded: `{g_check.grounded}`\n- Numbers in Answer: `{g_check.answer_numbers}`\n- Ungrounded: `{g_check.ungrounded}`")
            except Exception as e:
                final_briefing = f"**Data Summary:**\n\n{facts_combined}\n\n*(Note: Briefing synthesis note: {e})*"

            saved_log_path = logger.save()
            trace_lines.append(f"\n*Turn Log saved to: `{saved_log_path.name}`*")
            status_box.update(label="Analysis Complete & Logged!", state="complete", expanded=False)

        # Output to chat stream
        st.markdown(final_briefing)

        if all_rows:
            with st.expander(f"📊 Result Table ({len(all_rows)} rows)", expanded=True):
                st.dataframe(all_rows, use_container_width=True)

        full_trace_text = "\n\n".join(trace_lines)
        with st.expander("🔍 Agent Thought & Execution Trace", expanded=False):
            st.markdown(full_trace_text)

        # Store in session state
        st.session_state.messages.append({
            "role": "assistant",
            "content": final_briefing,
            "rows": all_rows if all_rows else None,
            "trace": full_trace_text,
        })
