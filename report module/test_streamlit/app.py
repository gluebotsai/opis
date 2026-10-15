"""Streamlit Unified Multi-Agent Analytics Chat Interface & Session Logger.

Clean conversational interface:
  - Product Switch: 🎧 Contact Center / 🎫 Ticketing
  - Input Context: Org ID, User ID, Role (clean & minimal)
  - Interactive Chat: st.chat_message, st.chat_input
  - Real-time Multi-Agent Execution & Logging:
      1. Domain Planning
      2. Certified KPI with Dimensional Grouping / Guarded SQL / Cypher Execution
      3. Automatic SQL Repair / Fallback on errors
      4. Structured Fact Assembly
      5. Anti-Hallucination Grounding Verification
      6. Executive Briefing Synthesis
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
CC_ROOT = WORKSPACE_ROOT / "reports_analytics_agent_contact_center"
TICKETING_ROOT = WORKSPACE_ROOT / "reports_analytics_agent_ticketing_v2"
CRM_ROOT = WORKSPACE_ROOT / "reports_analytics_agent_CRM_B2B"
TESTING_SCRIPTS = WORKSPACE_ROOT / "testing_scripts"

for p in [str(WORKSPACE_ROOT), str(CC_ROOT), str(TICKETING_ROOT), str(CRM_ROOT), str(TESTING_SCRIPTS), str(APP_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

# Load environment variables
for env_path in [
    WORKSPACE_ROOT / ".env",
    CC_ROOT / ".env",
    TICKETING_ROOT / ".env",
    CRM_ROOT / ".env",
    Path("/home/vectone/shiva/reportagent/.env"),
]:
    if env_path.exists():
        load_dotenv(env_path)

try:
    from testing_scripts.test_all_metrics_dimensions_time import get_dimension_sql
except ImportError:
    try:
        from test_all_metrics_dimensions_time import get_dimension_sql
    except ImportError:
        def get_dimension_sql(domain_name, kpi_id, dim, template_text):
            return None

from test_streamlit.logger import TurnLogger

st.set_page_config(
    page_title="Analytics V2 — Multi-Agent Chat",
    page_icon="💬",
    layout="wide",
)

# -----------------------------------------------------------------------------
# SIDEBAR: PRODUCT SELECTION & MINIMAL CONTEXT CONTROLS
# -----------------------------------------------------------------------------
with st.sidebar:
    st.header("⚙️ Product & Context")

    product_options = ["🎧 Contact Center", "🎫 Ticketing", "💼 B2B CRM"]
    if "selected_product" not in st.session_state:
        st.session_state.selected_product = product_options[0]

    product_choice = st.radio(
        "Product Domain",
        product_options,
        index=product_options.index(st.session_state.selected_product) if st.session_state.selected_product in product_options else 0,
        help="Select reporting domain pack",
        key="product_radio_selector",
    )

    is_crm = "CRM" in product_choice
    is_cc = "Contact Center" in product_choice
    domain_name = "crm" if is_crm else ("contact_center" if is_cc else "ticketing")

    # Reset chat history cleanly on domain change
    if product_choice != st.session_state.selected_product:
        st.session_state.selected_product = product_choice
        st.session_state.messages = []
        st.rerun()

    if is_crm:
        PACK_ROOT = CRM_ROOT
        default_org = 1003
        default_user = 1017
        role_options = ["admin", "sales_manager", "sales_rep", "presales", "finance", "marketing", "viewer"]
    elif is_cc:
        PACK_ROOT = CC_ROOT
        default_org = 1000
        default_user = 10
        role_options = ["admin", "agent"]
    else:
        PACK_ROOT = TICKETING_ROOT
        default_org = 1012
        default_user = 1028
        role_options = ["admin", "agent", "resolver"]

    # Only Org ID, User ID, Role as explicitly requested
    org_id = st.number_input(
        "Organization ID",
        value=default_org,
        step=1,
        help="Target tenant organization ID",
        key=f"org_input_{domain_name}",
    )
    user_id = st.number_input(
        "User ID",
        value=default_user,
        step=1,
        help="User ID of the caller",
        key=f"user_input_{domain_name}",
    )
    role = st.selectbox(
        "Role",
        role_options,
        index=0,
        help="Access role",
        key=f"role_input_{domain_name}",
    )

    st.divider()
    st.caption(f"🛡️ Active Context: **{role.upper()}** | Org `{org_id}` | User `{user_id}`")

    if st.button("🗑️ Clear Chat History", use_container_width=True):
        st.session_state.messages = []
        st.rerun()

    active_dsn = os.getenv(
        "DATABASE_URL",
        os.getenv("PG_DSN", "postgresql://nlp:nLpTeam%40561@10.180.0.126:5432/worktual_bigint"),
    )

    # Dynamic user queue auto-resolution
    def _fetch_db_queues(dsn: str, target_org: int, target_user: int, user_role: str, domain_cc: bool) -> list[int]:
        try:
            import psycopg2
            with psycopg2.connect(dsn) as conn:
                with conn.cursor() as cur:
                    if user_role == "admin":
                        tbl = "cc.queues" if domain_cc else "ticketing.agent_queues"
                        cur.execute(f"SELECT id FROM {tbl} WHERE organization_id = %s ORDER BY id", (target_org,))
                    else:
                        tbl = "cc.agent_queue_members" if domain_cc else "ticketing.agent_queue_members"
                        cur.execute(f"SELECT queue_id FROM {tbl} WHERE organization_id = %s AND user_id = %s ORDER BY queue_id", (target_org, target_user))
                    rows = cur.fetchall()
                    return [int(r[0]) for r in rows] if rows else []
        except Exception:
            return []

    auto_queues = _fetch_db_queues(active_dsn, int(org_id), int(user_id), role, is_cc)
    default_queues = auto_queues if auto_queues else ([1, 2] if is_cc else [1062, 1065])

    # Advanced connection parameters tucked cleanly in a collapsed expander
    with st.expander("🛠️ Advanced Settings", expanded=False):
        queue_ids_str = st.text_input(
            "Queue IDs",
            value=", ".join(str(q) for q in default_queues),
            help="Comma-separated queue IDs for agent/resolver context",
            key=f"queue_ids_{domain_name}_{org_id}_{user_id}_{role}",
        )
        queue_ids = [int(q.strip()) for q in queue_ids_str.split(",") if q.strip().isdigit()]

        llm_base_url = st.text_input(
            "LLM Endpoint",
            value=os.getenv("SQL_AGENT_LLM_URL", os.getenv("LLM_BASE_URL", "http://173.234.75.166:8011/v1")),
            key="llm_base_url_cfg",
        )
        llm_model = st.text_input(
            "LLM Model",
            value=os.getenv("SQL_AGENT_LLM_MODEL", os.getenv("LLM_MODEL_NAME", "worktual-gemma")),
            key="llm_model_cfg",
        )


# -----------------------------------------------------------------------------
# DYNAMIC MODULE RESOLUTION & SAFE CALLABLE WRAPPERS
# -----------------------------------------------------------------------------
if is_crm:
    import reports_analytics_agent_CRM_B2B.core.examples as ex_mod
    import reports_analytics_agent_CRM_B2B.core.facts as facts_mod
    import reports_analytics_agent_CRM_B2B.core.grounding as ground_mod
    import reports_analytics_agent_CRM_B2B.core.run_kpi as kpi_mod
    import reports_analytics_agent_CRM_B2B.core.run_sql as sql_mod
    import reports_analytics_agent_CRM_B2B.core.time as time_mod
    loop_mod = None
    cypher_mod = None
elif is_cc:
    import reports_analytics_agent_contact_center.sql_executor.core.examples as ex_mod
    import reports_analytics_agent_contact_center.core.facts as facts_mod
    import reports_analytics_agent_contact_center.core.grounding as ground_mod
    import reports_analytics_agent_contact_center.core.loop as loop_mod
    import reports_analytics_agent_contact_center.sql_executor.core.run_kpi as kpi_mod
    import reports_analytics_agent_contact_center.sql_executor.core.run_sql as sql_mod
    import reports_analytics_agent_contact_center.kg_executor.core.run_cypher as cypher_mod
    import reports_analytics_agent_contact_center.core.time as time_mod
else:
    import reports_analytics_agent_ticketing_v2.core.examples as ex_mod
    import reports_analytics_agent_ticketing_v2.core.facts as facts_mod
    import reports_analytics_agent_ticketing_v2.core.grounding as ground_mod
    import reports_analytics_agent_ticketing_v2.core.loop as loop_mod
    import reports_analytics_agent_ticketing_v2.core.run_cypher as cypher_mod
    import reports_analytics_agent_ticketing_v2.core.run_kpi as kpi_mod
    import reports_analytics_agent_ticketing_v2.core.run_sql as sql_mod
    import reports_analytics_agent_ticketing_v2.core.time as time_mod


def run_kpi_safe(*args, **kwargs) -> dict[str, Any]:
    if is_crm:
        # Adapt for B2B CRM signature
        kpi_id = args[0] if args else kwargs.get("kpi_id")
        org = kwargs.get("organization_id", int(org_id))
        uid = kwargs.get("user_id", int(user_id))
        u_role = kwargs.get("role", role)
        tw = kwargs.get("time_window", kwargs.get("time_expr"))
        dim = kwargs.get("dimension")
        slot_values = kwargs.get("slot_values")
        scope_level = kwargs.get("scope_level", "org")
        time_start = kwargs.get("time_start")
        time_end = kwargs.get("time_end")
        try:
            return kpi_mod.run_kpi(
                kpi_id=kpi_id,
                organization_id=org,
                user_id=uid,
                role=u_role,
                scope_level=scope_level,
                time_start=time_start,
                time_end=time_end,
                time_window=tw,
                dimension=dim,
                slot_values=slot_values,
            )
        except Exception as e:
            return {"status": "error", "error": str(e), "rows": []}
    try:
        fn = kpi_mod if callable(kpi_mod) else getattr(kpi_mod, "run_kpi")
        import inspect
        sig = inspect.signature(fn)
        has_varkw = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
        filtered_kwargs = kwargs if has_varkw else {k: v for k, v in kwargs.items() if k in sig.parameters}
        return fn(*args, **filtered_kwargs)
    except Exception as e:
        return {"status": "error", "error": str(e), "rows": []}


def run_sql_safe(*args, **kwargs) -> dict[str, Any]:
    try:
        fn = sql_mod if callable(sql_mod) else getattr(sql_mod, "run_sql")
        import inspect
        sig = inspect.signature(fn)
        has_varkw = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
        filtered_kwargs = kwargs if has_varkw else {k: v for k, v in kwargs.items() if k in sig.parameters}
        return fn(*args, **filtered_kwargs)
    except Exception as e:
        return {"status": "error", "error": str(e), "rows": []}


def run_cypher_safe(*args, **kwargs) -> dict[str, Any]:
    if cypher_mod is None:
        return {"status": "error", "error": "Cypher graph executor is not available for this domain"}
    try:
        fn = cypher_mod if callable(cypher_mod) else getattr(cypher_mod, "run_cypher")
        import inspect
        sig = inspect.signature(fn)
        has_varkw = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
        filtered_kwargs = kwargs if has_varkw else {k: v for k, v in kwargs.items() if k in sig.parameters}
        return fn(*args, **filtered_kwargs)
    except Exception as e:
        return {"status": "error", "error": str(e), "rows": []}


# -----------------------------------------------------------------------------
# LLM HELPERS
# -----------------------------------------------------------------------------
def call_llm(messages: list[dict[str, str]], temperature: float = 0.1, max_tokens: int = 600) -> str:
    """Send chat completion request to vLLM endpoint."""
    client = httpx.Client(base_url=llm_base_url.rstrip("/"), timeout=60.0)
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


def extract_cypher_query(text: str) -> str:
    """Extract Cypher query string from markdown block, json payload, or raw text."""
    clean = text.strip()
    parsed = extract_json(clean)
    if parsed and "cypher" in parsed:
        return str(parsed["cypher"]).strip()
    m_cyp = re.search(r"```(?:cypher)?\s*(MATCH\b.*?)\s*```", clean, re.DOTALL | re.IGNORECASE)
    if m_cyp:
        return m_cyp.group(1).strip()
    m_raw = re.search(r"\b(MATCH\b.*?)(?:;|\Z)", clean, re.DOTALL | re.IGNORECASE)
    if m_raw:
        return m_raw.group(1).strip()
    return clean


def detect_dimension(task: dict[str, Any], user_query: str, allowed_dimensions: list[str]) -> str | None:
    """Detect if a dimensional breakdown is requested in the task or query."""
    if not allowed_dimensions:
        return None

    # 1. Direct fields in task object
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

    # 2. Check query text against allowed dimensions and synonyms
    text = (str(task.get("goal", "")) + " " + user_query).lower()
    synonym_map = {
        "channel": ["channel", "channels"],
        "priority": ["priority", "priorities", "urgency"],
        "status": ["status", "state", "lifecycle"],
        "queue": ["queue", "queues", "group", "department"],
        "agent": ["agent", "agents", "assignee", "resolver", "rep", "who"],
        "resolver": ["resolver", "resolvers"],
        "category": ["category", "categories", "type"],
        "customer": ["customer", "customers", "client"],
        "day": ["by day", "daily", "per day"],
        "week": ["by week", "weekly", "per week"],
        "month": ["by month", "monthly", "per month"],
        "intent": ["intent", "intents"],
        "skill_key": ["skill", "skills", "skill_key"],
    }
    for dim in allowed_dimensions:
        synonyms = synonym_map.get(dim, [dim])
        if any(re.search(rf"\b{re.escape(syn)}\b", text) for syn in synonyms):
            return dim

    return None


def detect_filters(task: dict[str, Any], user_query: str, domain_name: str) -> str | None:
    """Detect specific status or priority filter clauses for certified KPI templates."""
    text = (str(task.get("goal", "")) + " " + user_query).lower()
    clauses: list[str] = []

    # Priority filters
    for p in ["urgent", "high", "medium", "low"]:
        if re.search(rf"\b{p}\b(?:\s+priority)?", text):
            clauses.append(f"priority = '{p}'")
            break

    # Status filters
    if domain_name == "ticketing":
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
    else:  # contact_center
        if re.search(r"\b(?:active|open)\s+(?:conversation|conversations|chats?|calls?)\b", text):
            clauses.append("status IN ('bot_active', 'queued', 'assigned', 'active')")
        elif re.search(r"\b(?:pending|unresolved|outstanding)\s+(?:conversation|conversations)\b", text):
            clauses.append("status NOT IN ('resolved', 'closed')")
        elif re.search(r"\bclosed\s+(?:conversation|conversations)\b", text):
            clauses.append("status = 'closed'")
        elif re.search(r"\bresolved\s+(?:conversation|conversations)\b", text):
            clauses.append("status = 'resolved'")
        elif re.search(r"\babandoned\s+(?:conversation|conversations|calls?)\b", text):
            clauses.append("is_abandoned = true")

    if clauses:
        return " AND ".join(clauses)
    return None


# -----------------------------------------------------------------------------
# LOAD METADATA & PROMPTS
# -----------------------------------------------------------------------------
domain_prompt_template = (PACK_ROOT / "domain" / "agent.md").read_text()
sql_prompt_template = (PACK_ROOT / "sql_executor" / "agent.md").read_text()
kg_prompt_template = (PACK_ROOT / "kg_executor" / "agent.md").read_text() if (PACK_ROOT / "kg_executor" / "agent.md").exists() else ""

sql_product_dir = (PACK_ROOT / "product" / "sql") if is_cc else (PACK_ROOT / "product")
kpis_doc = yaml.safe_load((sql_product_dir / "kpis.yml").read_text()) or {}
certified_kpis_defs = kpis_doc.get("kpis") if isinstance(kpis_doc, dict) and "kpis" in kpis_doc else (kpis_doc if isinstance(kpis_doc, dict) else {})

schema_path = sql_product_dir / "schema.yml"
if schema_path.exists():
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
else:
    views_summary = ""

sql_examples_path = sql_product_dir / "examples" / "sql.yml"
kg_examples_path = PACK_ROOT / "product" / "kg" / "examples" / "cypher.yml"
kg_schema_path = PACK_ROOT / "product" / "kg" / "schema_registry.json"

if kg_schema_path.exists():
    try:
        kg_sdata = json.loads(kg_schema_path.read_text())
        kg_lines = ["## Graph Schema & Allowed Properties:"]
        props_map = kg_sdata.get("properties", {})
        if isinstance(props_map, dict):
            for label, props in props_map.items():
                kg_lines.append(f"### Node `:{label}`:")
                kg_lines.append(f"  Properties: {', '.join(props[:25])}")
        else:
            kg_lines.append(f"  Properties: {', '.join(list(props_map)[:40])}")
        kg_lines.append(f"\n### Allowed Relationships:\n{', '.join(kg_sdata.get('relationships', []))}")
        kg_schema_summary = "\n".join(kg_lines)
    except Exception:
        kg_schema_summary = ""
else:
    kg_schema_summary = ""

kg_templates_path = PACK_ROOT / "product" / "kg" / "templates.yml"
if kg_templates_path.exists():
    try:
        with open(kg_templates_path, "r", encoding="utf-8") as f:
            kg_tdata = yaml.safe_load(f) or {}
        tmpl_lines = ["## Certified Cypher Templates:"]
        for t_id, meta in kg_tdata.get("templates", {}).items():
            desc = meta.get("description", "")
            params = ", ".join(meta.get("parameters", []))
            tmpl_lines.append(f"- `{t_id}`: {desc} (Parameters: {params or 'none'})")
        kg_templates_summary = "\n".join(tmpl_lines)
    except Exception:
        kg_templates_summary = ""
else:
    kg_templates_summary = ""



# -----------------------------------------------------------------------------
# CHAT INTERFACE & RENDERING
# -----------------------------------------------------------------------------
title_text = "💼 B2B CRM Analytics Agent" if is_crm else ("🎧 Contact Center Analytics Agent" if is_cc else "🎫 Ticketing Analytics Agent")
st.title(title_text)
st.caption(f"Domain: **{product_choice}** | Active Context: **{role.upper()}** (Org `{org_id}`, User `{user_id}`)")

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
placeholder_txt = (
    "Ask a question (e.g. 'What is our ASA this month?', 'Show containment rate', 'List conversations by channel')"
    if is_cc
    else "Ask a question (e.g. 'How many tickets were created this month?', 'Show ticket count by priority')"
)

if user_query := st.chat_input(placeholder_txt):
    # Add user message to UI
    st.session_state.messages.append({"role": "user", "content": user_query})
    with st.chat_message("user"):
        st.markdown(user_query)

    # Run Multi-Agent Turn
    with st.chat_message("assistant"):
        logger = TurnLogger(
            question=user_query.strip(),
            context={
                "product": domain_name,
                "org_id": int(org_id),
                "user_id": int(user_id),
                "role": role,
                "queue_ids": queue_ids,
                "llm_model": llm_model,
            },
        )
        trace_lines = []

        with st.status("Agents are analyzing, planning, and querying database...", expanded=True) as status_box:
            # Prior conversation history for multi-turn context
            prior_msgs = st.session_state.messages[:-1]
            history_str = ""
            if prior_msgs:
                h_lines = []
                for m in prior_msgs[-4:]:
                    r_label = "User" if m.get("role") == "user" else "Analyst"
                    snippet = str(m.get("content", ""))[:250].replace("\n", " ").strip()
                    h_lines.append(f"- {r_label}: {snippet}")
                if h_lines:
                    history_str = "Recent Conversation History:\n" + "\n".join(h_lines) + "\n\n"

            # 1. Domain Agent Planning
            domain_user_msg = (
                f"Identity: role={role}, org_id={org_id}, user_id={user_id}, queues={queue_ids}\n\n"
                f"{history_str}"
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
                depth = plan_data.get("depth", "standard")
                tasks_cnt = len(plan_data.get("tasks", []))
                st.write(f"🧠 **Domain Plan**: `{depth}` depth, `{tasks_cnt}` task(s)")
                trace_lines.append(f"### 1. Domain Plan\n```json\n{json.dumps(plan_data, indent=2)}\n```")
            except Exception as e:
                st.error(f"Planning Error: {e}")
                logger.log_message(role="error", agent="domain_agent", content=str(e))

            tasks = plan_data.get("tasks", [])
            # Fallback if domain returned no tasks
            if not tasks:
                tasks = [{
                    "id": "t1",
                    "executor": "sql",
                    "kpi": None,
                    "goal": user_query,
                    "time": "all time",
                    "scope": "org" if role == "admin" else "own",
                    "answer_type": "kpi",
                }]

            all_facts = []
            all_rows = []

            # 2. Execution Loop
            for task in tasks:
                task_id = task.get("id", "t1")
                executor = task.get("executor", "sql")
                kpi_id = task.get("kpi")
                time_expr = task.get("time") or "all time"
                scope_expr = task.get("scope", "org" if role == "admin" else "own")
                goal = task.get("goal", user_query)
                answer_type = task.get("answer_type", "kpi")

                st.write(f"⚙️ **Executing Task `{task_id}`** via `{executor}` ({goal})...")

                try:
                    tb = time_mod.resolve_expression(time_expr)
                except Exception:
                    tb = time_mod.TimeBounds(None, None, "overall (no date filter, UTC)")
                start_iso = tb.start.isoformat() if tb.start else None
                end_iso = tb.end.isoformat() if tb.end else None

                task_result: dict[str, Any] = {}

                # 1. Cypher Execution
                if executor == "kg" and cypher_mod is not None:
                    kg_ex_list = ex_mod.load_examples(kg_examples_path) if kg_examples_path.exists() else []
                    chosen_kg_ex = ex_mod.pick_examples(goal, kg_ex_list, top_k=4, kind="cypher")
                    kg_few_shot = ex_mod.format_examples_for_prompt(chosen_kg_ex, kind="cypher") if chosen_kg_ex else ""
                    task_kg_prompt = f"{kg_prompt_template}\n\n{kg_schema_summary}\n\n{kg_templates_summary}\n\n## Few-Shot Cypher Examples\n{kg_few_shot}"
                    kg_user_msg = f"Task Goal: {goal}\ntime: {start_iso} to {end_iso}\nscope: {scope_expr}"

                    logger.log_message(role="system", agent="kg_executor", content=task_kg_prompt)
                    logger.log_message(role="user", agent="kg_executor", content=kg_user_msg)

                    kg_raw = call_llm(
                        [{"role": "system", "content": task_kg_prompt}, {"role": "user", "content": kg_user_msg}],
                        temperature=0.1,
                    )
                    logger.log_message(role="assistant", agent="kg_executor", content=kg_raw)

                    parsed_kg = extract_json(kg_raw)
                    tmpl = parsed_kg.get("template") if parsed_kg else None
                    if tmpl in (None, "null", "", "None"):
                        tmpl = None

                    cypher_query = parsed_kg.get("cypher", "") if parsed_kg else extract_cypher_query(kg_raw)

                    if tmpl:
                        logger.log_tool_call(agent="kg_executor", tool_name="run_cypher_template", arguments={"template": tmpl})
                        task_result = run_cypher_safe(
                            template_name=tmpl,
                            organization_id=int(org_id),
                            user_id=int(user_id),
                            role=role,
                            queue_ids=queue_ids,
                            execute=True,
                        )
                    else:
                        logger.log_tool_call(agent="kg_executor", tool_name="run_cypher", arguments={"cypher": cypher_query})
                        task_result = run_cypher_safe(
                            cypher=cypher_query,
                            organization_id=int(org_id),
                            user_id=int(user_id),
                            role=role,
                            queue_ids=queue_ids,
                            execute=True,
                        )

                    # Quick Repair Attempt if Cypher Failed
                    if task_result.get("status") == "error":
                        err_msg = task_result.get("error", "Unknown Cypher error")
                        repair_msg = (
                            f"Task Goal: {goal}\n"
                            f"Previous Cypher:\n```cypher\n{cypher_query}\n```\n"
                            f"Database/Guard Error: {err_msg}\n"
                            "Rewrite the Cypher query to fix the error. Use ONLY valid labels, relationships, and properties from the CCaaS graph schema allowlist."
                        )
                        repair_raw = call_llm(
                            [{"role": "system", "content": task_kg_prompt}, {"role": "user", "content": repair_msg}],
                            temperature=0.1,
                        )
                        repaired_cypher = extract_cypher_query(repair_raw)
                        logger.log_tool_call(agent="kg_executor", tool_name="run_cypher_repair", arguments={"repaired_cypher": repaired_cypher})
                        task_result = run_cypher_safe(
                            cypher=repaired_cypher,
                            organization_id=int(org_id),
                            user_id=int(user_id),
                            role=role,
                            queue_ids=queue_ids,
                            execute=True,
                        )

                    trace_lines.append(f"### 2. Task `{task_id}` (Guarded Cypher)\n```cypher\n{task_result.get('cypher', '')}\n```")


                # 2. Certified KPI Execution
                crm_kpi_aliases = {
                    "total_deals_count": "total_opportunities",
                    "total_deals": "total_opportunities",
                    "deal_count": "total_opportunities",
                    "all_deals": "total_opportunities",
                    "active_deals_count": "active_opportunities",
                    "active_deals": "active_opportunities",
                    "open_deals_count": "active_opportunities",
                    "open_deals": "active_opportunities",
                    "won_deals_count": "won_deals",
                    "lost_deals_count": "lost_deals",
                    "pipeline_value": "total_pipeline",
                    "total_pipeline_value": "total_pipeline",
                    "active_pipeline": "total_pipeline",
                    "total_pipeline_amount": "total_pipeline",
                }
                effective_kpi_id = crm_kpi_aliases.get(kpi_id, kpi_id) if is_crm else kpi_id
                if effective_kpi_id and effective_kpi_id in certified_kpis_defs:
                    kpi_id = effective_kpi_id
                    kpi_card = certified_kpis_defs[kpi_id]
                    allowed_dims = list(kpi_card.get("allowed_dimensions") or [])
                    dim = detect_dimension(task, user_query, allowed_dims)

                    slot_values = {}
                    if dim:
                        template_file = PACK_ROOT / "product" / "sql" / f"{kpi_id}.sql"
                        template_text = template_file.read_text() if template_file.exists() else ""
                        dim_sql = get_dimension_sql(domain_name, kpi_id, dim, template_text)
                        if dim_sql is None:
                            st.write(f"⚠️ No SQL mapping for dimension `{dim}` on `{kpi_id}`")
                            dim_sel, grp_sql = "", ""
                        else:
                            dim_sel, grp_sql = dim_sql
                        slot_values["dimension_select"] = dim_sel
                        slot_values["group_by_sql"] = grp_sql
                        st.write(f"📊 Applying grouping dimension: **`{dim}`**")

                    filt = detect_filters(task, user_query, domain_name)
                    if filt:
                        slot_values["filters_sql"] = filt
                        st.write(f"🔍 Applying filter: **`{filt}`**")

                    logger.log_tool_call(
                        agent="certified_kpi_executor",
                        tool_name="run_kpi",
                        arguments={"kpi_id": kpi_id, "scope": scope_expr, "time": tb.echo, "dimension": dim, "filter": filt},
                    )

                    task_result = run_kpi_safe(
                        kpi_id,
                        organization_id=int(org_id),
                        user_id=int(user_id),
                        role=role,
                        queue_ids=queue_ids,
                        scope_level=scope_expr,
                        time_start=start_iso,
                        time_end=end_iso,
                        slot_values=slot_values,
                        dimension=dim,
                        time_window=time_expr,
                        dsn=active_dsn,
                    )

                    logger.log_guard(
                        guard_type="KPI_Template_Slots",
                        input_query=kpi_id,
                        output_query=task_result.get("sql", ""),
                        params={"org_id": org_id, "scope": scope_expr, "dimension": dim, "filter": filt},
                        error=task_result.get("error") if task_result.get("status") == "error" else None,
                    )
                    trace_lines.append(f"### 2. Task `{task_id}` (Certified KPI: `{kpi_id}`)\n```sql\n{task_result.get('sql', '')}\n```")

                # 3. Free SQL Execution (or Fallback if KPI errored)
                if executor != "kg" and ((not kpi_id) or (task_result.get("status") == "error")):
                    if task_result.get("status") == "error":
                        st.write(f"🔄 KPI `{kpi_id}` error: {task_result.get('error')}. Switching to free SQL for `{task_id}`...")

                    if start_iso and end_iso:
                        time_ctx = f"time_params: start={start_iso}, end={end_iso}\nparams_available: :start, :end"
                        query_params = {"start": start_iso, "end": end_iso}
                    else:
                        time_ctx = "time_params: overall / all-time (unbounded, no date filter)\nparams_available: none"
                        query_params = {}

                    # Dynamic Few-Shot Picking
                    sql_ex_list = ex_mod.load_examples(sql_examples_path) if sql_examples_path.exists() else []
                    chosen_sql_ex = ex_mod.pick_examples(goal, sql_ex_list, top_k=6, kind="sql")
                    sql_few_shot = ex_mod.format_examples_for_prompt(chosen_sql_ex, kind="sql") if chosen_sql_ex else ""
                    task_sql_prompt = f"{sql_prompt_template}\n\n{views_summary}\n\n## Few-Shot SQL Examples\n{sql_few_shot}"
                    sql_user_msg = f"Task Goal: {goal}\n{time_ctx}\nscope: {scope_expr}\nanswer_type: {answer_type}"

                    logger.log_message(role="system", agent="sql_executor", content=task_sql_prompt)
                    logger.log_message(role="user", agent="sql_executor", content=sql_user_msg)

                    sql_raw = call_llm(
                        [{"role": "system", "content": task_sql_prompt}, {"role": "user", "content": sql_user_msg}],
                        temperature=0.1,
                    )
                    logger.log_message(role="assistant", agent="sql_executor", content=sql_raw)

                    sql_query = extract_sql_query(sql_raw)
                    logger.log_tool_call(agent="sql_executor", tool_name="run_sql", arguments={"raw_sql": sql_query})

                    task_result = run_sql_safe(
                        sql_query,
                        organization_id=int(org_id),
                        user_id=int(user_id),
                        role=role,
                        queue_ids=queue_ids,
                        params=query_params,
                        dsn=active_dsn,
                    )

                    # Quick Repair Attempt if SQL Failed
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
                        logger.log_tool_call(agent="sql_executor", tool_name="run_sql_repair", arguments={"repaired_sql": repaired_sql})
                        task_result = run_sql_safe(
                            repaired_sql,
                            organization_id=int(org_id),
                            user_id=int(user_id),
                            role=role,
                            queue_ids=queue_ids,
                            params=query_params,
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
                fact = facts_mod.assemble_facts(
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

            audience = "Contact Center Leadership" if is_cc else ("Sales & Revenue Leadership" if is_crm else "the CEO")
            time_display_str = tb.echo if (tb.start or tb.end) else f"overall across all time in Organization {org_id}"
            synthesis_prompt = (
                f"You are the Lead Analyst briefing {audience}.\n\n"
                f"Active Context: Organization ID: {org_id}, User ID: {user_id}, Role: {role.upper()}, Time: {time_display_str}.\n"
                f"{history_str}"
                f"Original Question: {user_query}\n"
                f"Facts gathered:\n{facts_combined}\n\n"
                "Instructions:\n"
                "- Write a clear, executive-level answer directly addressing the user's question.\n"
                f"- Lead with the exact primary number or finding in the very first sentence, explicitly stating the active organization and timeframe (e.g., 'Across all time in Organization {org_id}, there are **14 total deals**...').\n"
                "- Use bold markdown for key metrics and figures.\n"
                "- Explain business/operational context concisely. If there are top groups, stages, or owners, summarize them in a clean Markdown table.\n"
                f"- If the primary number is 0 or no records exist, clearly state: 'There are currently 0 records found in Organization {org_id} for this scope. (Note: To query another tenant such as Org 1003 or 1000, update the Organization ID in the sidebar).' \n"
                "- Do NOT mention internal errors, REPLAN, system architecture, or pipeline tools. State business facts clearly.\n"
                "- Do NOT use headings like 'Analysis' or 'Narrative'. Just clean, natural prose."
            )
            logger.log_message(role="system", agent="domain_synthesis", content="Executive analyst briefing.")
            logger.log_message(role="user", agent="domain_synthesis", content=synthesis_prompt)

            try:
                raw_briefing = call_llm(
                    [{"role": "system", "content": f"You are a senior analyst giving an executive briefing to {audience}."}, {"role": "user", "content": synthesis_prompt}],
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
                        [{"role": "system", "content": f"You are a senior analyst giving an executive briefing to {audience}."}, {"role": "user", "content": regen_prompt}],
                        temperature=0.1,
                        max_tokens=600,
                    )

                final_briefing, was_grounded = ground_mod.apply_grounding(raw_briefing, facts_combined, _regen_briefing)
                g_check = ground_mod.ground_check(final_briefing, facts_combined)
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
